import * as path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  discoverCompoundsBySubtree,
  loadCompound,
  loadWorkspaceWithDiagnostics,
} from "@chemag/core/loader";
import { checkImports, type ImportCheckScope } from "@chemag/core/import-check";
import type { LanguagePlugin } from "@chemag/core/plugin-interface";
import type {
  Diagnostic,
  LanguageSubtree,
  LoadedCompound,
  ParsedImport,
  Workspace,
} from "@chemag/core/types";
import { applyWorkspaceVocabulary, tr } from "@chemag/core/vocabulary";
import { emit as emitTelemetry } from "@chemag/telemetry";
import { contentHash, createImportCache, createManifestCache } from "@chemag/core/cache";
import { loadPlugin } from "../plugin-loader.js";
import {
  formatDiagnostics,
  isFormatName,
  type FormatContext,
  type FormatName,
} from "../format/index.js";
import { VERSION } from "../version.js";

// Test-overridable stdin reader. Production reads file-descriptor 0. Tests
// inject a fake by calling __setStdinReader(). Mirrors the seam in
// check-edit.ts so --for-hook claude can be unit-tested without a subprocess.
let stdinReader: () => string = () => readFileSync(0, "utf-8");
export function __setStdinReaderForTesting(fn: () => string): void {
  stdinReader = fn;
}
export function __resetStdinReaderForTesting(): void {
  stdinReader = () => readFileSync(0, "utf-8");
}

const R = "\x1b[0m";
const RED = "\x1b[31m";

export function cmdAnalyze(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`\n\x1b[1m${tr("cli.command.analyze")}\x1b[0m\n`);
    console.log(
      "\x1b[1mOptions:\x1b[0m\n" +
        "  --format <fmt>   Output format: human|json|sarif|junit (default: human)\n" +
        "  --json           DEPRECATED. Alias for --format json that preserves the legacy ad-hoc shape. Use --format json instead.\n" +
        "  --for-hook claude  Emit Claude Code PostToolUse envelope; reads stdin JSON for tool_input.file_path.\n" +
        "  --workspace <path>   Workspace root or path to workspace.yaml.\n",
    );
    process.exit(0);
  }

  const forHook = parseForHookFlag(argv);
  const explicitWorkspace = parseWorkspaceFlag(argv);

  // --for-hook claude takes precedence: it routes through the hook envelope
  // emitter, never emits the standard analyze output, and always exits 0
  // (PostToolUse is informational; engine errors are stderr-only).
  if (forHook === "claude") {
    runForHookClaude(argv, explicitWorkspace);
    return;
  }

  const legacyJson = argv.includes("--json");

  const format = parseFormatFlag(argv);
  if (format !== null && legacyJson) {
    console.error(
      `${RED}--json and --format are mutually exclusive; --json is deprecated, use --format${R}`,
    );
    process.exit(2);
  }
  if (format === "__invalid__") {
    console.error(`${RED}Invalid --format value. Expected one of: human, json, sarif, junit${R}`);
    process.exit(2);
  }
  const resolvedFormat: FormatName = format ?? "human";

  if (legacyJson) {
    console.error(
      "warning: --json is deprecated; use --format json. Note: --json continues to emit the legacy ad-hoc shape for backward compatibility.",
    );
  }

  // Resolve workspace path. Standard path: positional argument is workspace.yaml.
  // (--workspace is consumed only by --for-hook claude to keep argv parsing simple
  // for the existing wp-005 contract.)
  const positional = stripFlags(argv).find((a) => !a.startsWith("-"));
  if (!positional && !explicitWorkspace) {
    console.error(`${RED}No workspace file specified.${R}`);
    process.exit(2);
  }

  const wsPath = positional
    ? path.resolve(positional)
    : resolveWorkspaceArg(explicitWorkspace as string);
  if (!wsPath) {
    console.error(`${RED}Could not locate workspace.yaml${R}`);
    process.exit(2);
  }
  const wsDir = path.dirname(wsPath);
  const manifestCache = createManifestCache(wsDir);
  const importCache = createImportCache(wsDir);

  let ws: Workspace;
  // Loader-phase diagnostics (e.g. CHEM-MANIFEST-005 for invalid
  // rules.io_modules regexes) flow into the analyze output stream so a user
  // running `chemag analyze` sees them too. They are also surfaced through
  // `chemag check`; both paths use the same cache record so a hit on either
  // side replays the diagnostics.
  let loaderDiagnostics: Diagnostic[] = [];
  try {
    const raw = readFileSync(wsPath, "utf-8");
    const hash = contentHash(raw);
    const cached = manifestCache.getWorkspaceWithDiagnostics(wsPath, hash);
    if (cached !== null) {
      ws = cached.workspace;
      loaderDiagnostics = cached.diagnostics;
    } else {
      const result = loadWorkspaceWithDiagnostics(wsPath);
      ws = result.workspace;
      loaderDiagnostics = result.diagnostics;
      manifestCache.setWorkspaceWithDiagnostics(wsPath, ws, loaderDiagnostics, hash);
    }
  } catch (e: unknown) {
    console.error(`${RED}Failed to load workspace:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  // Phase 2 — adopt workspace.vocabulary if Phase 1 (cli.ts) didn't already
  // settle on a stronger source. Must run before any tr() output below.
  applyWorkspaceVocabulary(ws);

  let groups: { scope: LanguageSubtree; compounds: LoadedCompound[] }[];
  try {
    groups = discoverCompoundsBySubtree(ws, wsDir, {
      loadCompound: (manifestPath: string): LoadedCompound => {
        const raw = readFileSync(manifestPath, "utf-8");
        const hash = contentHash(raw);
        const cached = manifestCache.getCompound(manifestPath, hash);
        if (cached !== null) return cached;
        const parsed = loadCompound(manifestPath);
        manifestCache.setCompound(manifestPath, parsed, hash);
        return parsed;
      },
    });
  } catch (e: unknown) {
    console.error(`${RED}Failed to discover compounds:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  // WP-020: load one plugin per sub-tree and feed checkImports a list of
  // {plugin, scope, compounds} triples.
  const scopes: ImportCheckScope[] = groups.map((g) => ({
    plugin: loadPlugin({ language: g.scope.language }),
    scope: g.scope,
    compounds: g.compounds,
  }));

  const totalFiles = scopes.reduce(
    (n, s) => n + s.compounds.reduce((m, c) => m + (c.manifest.units?.length ?? 0), 0),
    0,
  );

  const importDiags = checkImports(ws, scopes, {
    parseImportsBatch: (filePaths: string[], p: LanguagePlugin, _scope: LanguageSubtree) => {
      // The hook is invoked once per sub-tree (wp-020). The per-file content
      // cache is keyed by absolute path, which remains unique across
      // sub-trees, so we can ignore `_scope` here without risk of collisions.
      const result = new Map<string, ParsedImport[]>();
      const misses: { abs: string; hash: string }[] = [];

      for (const abs of filePaths) {
        let raw: string;
        try {
          raw = readFileSync(abs, "utf-8");
        } catch {
          // Source file unreadable — let the plugin try (it may fail gracefully).
          continue;
        }
        const hash = contentHash(raw);
        const cached = importCache.get(abs, hash);
        if (cached !== null) {
          result.set(abs, cached);
        } else {
          misses.push({ abs, hash });
        }
      }

      if (misses.length > 0) {
        const parsedMisses = p.parseImportsBatch(misses.map((m) => m.abs));
        for (const { abs, hash } of misses) {
          const parsed = parsedMisses.get(abs) ?? [];
          importCache.set(abs, parsed, hash);
          result.set(abs, parsed);
        }
      }

      return result;
    },
  });

  // Loader diagnostics surface alongside source-import diagnostics. They
  // appear first so the user sees workspace-config errors before per-file
  // findings.
  const diags: Diagnostic[] = [...loaderDiagnostics, ...importDiags];
  const errors = diags.filter((d) => d.level === "error");
  const warnings = diags.filter((d) => d.level === "warning");

  if (legacyJson) {
    console.log(
      JSON.stringify(
        {
          errors: errors.length,
          warnings: warnings.length,
          diagnostics: diags,
        },
        null,
        2,
      ),
    );
    emitViolations(diags);
    process.exit(errors.length > 0 ? 1 : 0);
  }

  const ctx: FormatContext = {
    workspaceName: ws.workspace,
    workspacePath: wsDir,
    command: "analyze",
    toolVersion: VERSION,
    totals: { units: totalFiles },
  };

  const out = formatDiagnostics(diags, resolvedFormat, ctx);
  console.log(out.endsWith("\n") ? out.slice(0, -1) : out);

  emitViolations(diags);

  process.exit(errors.length > 0 ? 1 : 0);
}

/**
 * Emit `cli.violations.found` (count + check_kinds[]). NO file paths.
 * Fire-and-forget; safe no-op when consent is absent.
 */
function emitViolations(diags: Diagnostic[]): void {
  if (diags.length === 0) return;
  const kinds = new Set<string>();
  for (const d of diags) {
    const code = d.code;
    if (typeof code !== "string") continue;
    const parts = code.split("-");
    if (parts.length >= 2) kinds.add(parts[1]);
  }
  void emitTelemetry("cli.violations.found", {
    count: diags.length,
    check_kinds: Array.from(kinds),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

function parseFormatFlag(argv: string[]): FormatName | "__invalid__" | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("-")) return "__invalid__";
      return isFormatName(v) ? v : "__invalid__";
    }
    if (a.startsWith("--format=")) {
      const v = a.slice("--format=".length);
      return isFormatName(v) ? v : "__invalid__";
    }
  }
  return null;
}

function stripFlags(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format") {
      i++;
      continue;
    }
    if (a.startsWith("--format=")) continue;
    if (a === "--json") continue;
    if (a === "--for-hook") {
      i++;
      continue;
    }
    if (a.startsWith("--for-hook=")) continue;
    if (a === "--workspace") {
      i++;
      continue;
    }
    if (a.startsWith("--workspace=")) continue;
    out.push(a);
  }
  return out;
}

function parseForHookFlag(argv: string[]): "claude" | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--for-hook") {
      const v = argv[i + 1];
      return v === "claude" ? "claude" : null;
    }
    if (a.startsWith("--for-hook=")) {
      const v = a.slice("--for-hook=".length);
      return v === "claude" ? "claude" : null;
    }
  }
  return null;
}

function parseWorkspaceFlag(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace") return argv[i + 1] ?? null;
    if (a.startsWith("--workspace=")) return a.slice("--workspace=".length);
  }
  return null;
}

/**
 * Resolve a `--workspace` arg (which may be either a workspace.yaml path or
 * a directory containing it). Returns the absolute workspace.yaml path or
 * null if not found.
 */
function resolveWorkspaceArg(arg: string): string | null {
  const abs = path.resolve(arg);
  if (!existsSync(abs)) return null;
  if (statSync(abs).isDirectory()) {
    const cand = path.resolve(abs, "workspace.yaml");
    return existsSync(cand) ? cand : null;
  }
  return abs;
}

// ---------------------------------------------------------------------------
// --for-hook claude (PostToolUse) implementation
// ---------------------------------------------------------------------------

interface PostToolUseEnvelope {
  hookSpecificOutput: {
    hookEventName: "PostToolUse";
    additionalContext: string;
  };
}

/**
 * Read stdin JSON, locate the workspace, run analyze, and emit a Claude Code
 * PostToolUse envelope (additionalContext only — never permissionDecision).
 *
 * Failure modes — ALL exit 0:
 *   - stdin malformed or missing tool_input.file_path → no envelope on stdout,
 *     stderr CHEM-INSTALL-HOOKS-006.
 *   - workspace not locatable → no envelope on stdout (silent pass).
 *   - clean workspace (no diagnostics) → no envelope on stdout.
 *   - engine crash → no envelope, stderr trace, exit 0 (we never block tool
 *     edits via PostToolUse — the tool already ran).
 */
function runForHookClaude(argv: string[], explicitWorkspace: string | null): void {
  // Read stdin envelope first; failure → stderr 006 + exit 0.
  let raw: string;
  try {
    raw = stdinReader();
  } catch (e) {
    console.error(
      `CHEM-INSTALL-HOOKS-006: ${tr("diagnostic.hook_stdin_unparseable", {
        reason: e instanceof Error ? e.message : String(e),
      })}`,
    );
    process.exit(0);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(
      `CHEM-INSTALL-HOOKS-006: ${tr("diagnostic.hook_stdin_unparseable", {
        reason: e instanceof Error ? e.message : "invalid JSON",
      })}`,
    );
    process.exit(0);
  }

  if (typeof parsed !== "object" || parsed === null) {
    console.error(
      `CHEM-INSTALL-HOOKS-006: ${tr("diagnostic.hook_stdin_unparseable", {
        reason: "stdin JSON is not an object",
      })}`,
    );
    process.exit(0);
  }
  const obj = parsed as Record<string, unknown>;
  const toolInput = obj.tool_input;
  if (typeof toolInput !== "object" || toolInput === null) {
    console.error(
      `CHEM-INSTALL-HOOKS-006: ${tr("diagnostic.hook_stdin_unparseable", {
        reason: "missing tool_input",
      })}`,
    );
    process.exit(0);
  }
  const filePath = (toolInput as Record<string, unknown>).file_path;
  if (typeof filePath !== "string" || filePath === "") {
    console.error(
      `CHEM-INSTALL-HOOKS-006: ${tr("diagnostic.hook_stdin_unparseable", {
        reason: "missing tool_input.file_path",
      })}`,
    );
    process.exit(0);
  }

  // Resolve workspace. Prefer --workspace; fall back to walking up from the
  // edited file's directory.
  const wsPath = explicitWorkspace
    ? resolveWorkspaceArg(explicitWorkspace)
    : findWorkspaceFromFile(filePath);
  if (!wsPath) {
    // No workspace → silent pass.
    process.exit(0);
  }

  // Run analyze. Wrap in try/catch — any engine error is logged to stderr
  // (with no envelope) so PostToolUse stays silent on the model side.
  let diags: Diagnostic[] = [];
  try {
    diags = runWorkspaceAnalyze(wsPath);
  } catch (e) {
    console.error(`analyze (--for-hook claude) failed: ${(e as Error).message}`);
    process.exit(0);
  }

  if (diags.length === 0) {
    // Clean workspace — no envelope, exit 0.
    process.exit(0);
  }

  const additionalContext = formatPostHookSummary(diags, filePath);
  const envelope: PostToolUseEnvelope = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext,
    },
  };
  console.log(JSON.stringify(envelope));
  process.exit(0);
}

function findWorkspaceFromFile(file: string): string | null {
  // Walk up from file's directory looking for workspace.yaml.
  let dir = path.isAbsolute(file) ? path.dirname(file) : path.dirname(path.resolve(file));
  let lastDir: string | null = null;
  while (dir && dir !== lastDir) {
    const cand = path.resolve(dir, "workspace.yaml");
    if (existsSync(cand)) return cand;
    lastDir = dir;
    dir = path.dirname(dir);
  }
  return null;
}

function runWorkspaceAnalyze(wsPath: string): Diagnostic[] {
  const wsDir = path.dirname(wsPath);
  const manifestCache = createManifestCache(wsDir);
  const importCache = createImportCache(wsDir);

  const raw = readFileSync(wsPath, "utf-8");
  const hash = contentHash(raw);
  let ws: Workspace;
  let loaderDiagnostics: Diagnostic[] = [];
  const cached = manifestCache.getWorkspaceWithDiagnostics(wsPath, hash);
  if (cached !== null) {
    ws = cached.workspace;
    loaderDiagnostics = cached.diagnostics;
  } else {
    const result = loadWorkspaceWithDiagnostics(wsPath);
    ws = result.workspace;
    loaderDiagnostics = result.diagnostics;
    manifestCache.setWorkspaceWithDiagnostics(wsPath, ws, loaderDiagnostics, hash);
  }

  applyWorkspaceVocabulary(ws);

  const groups = discoverCompoundsBySubtree(ws, wsDir, {
    loadCompound: (manifestPath: string): LoadedCompound => {
      const r = readFileSync(manifestPath, "utf-8");
      const h = contentHash(r);
      const c = manifestCache.getCompound(manifestPath, h);
      if (c !== null) return c;
      const parsed = loadCompound(manifestPath);
      manifestCache.setCompound(manifestPath, parsed, h);
      return parsed;
    },
  });

  // WP-020: one plugin per sub-tree.
  const scopes: ImportCheckScope[] = groups.map((g) => ({
    plugin: loadPlugin({ language: g.scope.language }),
    scope: g.scope,
    compounds: g.compounds,
  }));

  const importDiags = checkImports(ws, scopes, {
    parseImportsBatch: (filePaths: string[], p: LanguagePlugin, _scope: LanguageSubtree) => {
      const result = new Map<string, ParsedImport[]>();
      const misses: { abs: string; hash: string }[] = [];
      for (const abs of filePaths) {
        let r: string;
        try {
          r = readFileSync(abs, "utf-8");
        } catch {
          continue;
        }
        const h = contentHash(r);
        const c = importCache.get(abs, h);
        if (c !== null) {
          result.set(abs, c);
        } else {
          misses.push({ abs, hash: h });
        }
      }
      if (misses.length > 0) {
        const parsedMisses = p.parseImportsBatch(misses.map((m) => m.abs));
        for (const { abs, hash: h } of misses) {
          const parsed = parsedMisses.get(abs) ?? [];
          importCache.set(abs, parsed, h);
          result.set(abs, parsed);
        }
      }
      return result;
    },
  });

  return [...loaderDiagnostics, ...importDiags];
}

/** Compose the additionalContext string shown to the model. */
function formatPostHookSummary(diags: Diagnostic[], editedFile: string): string {
  const errors = diags.filter((d) => d.level === "error");
  const warnings = diags.filter((d) => d.level === "warning");
  const lines: string[] = [];
  lines.push(
    `chemag analyze (PostToolUse) — ${errors.length} error(s), ${warnings.length} warning(s) after editing ${editedFile}`,
  );
  // Cap the listed diagnostics so PostToolUse doesn't flood the model.
  const cap = 20;
  const interesting = [...errors, ...warnings].slice(0, cap);
  for (const d of interesting) {
    const code = d.code ?? "CHEM-???";
    const file = d.file ?? "";
    lines.push(`- [${code}] ${file ? `${file}: ` : ""}${d.message}`);
  }
  if (errors.length + warnings.length > cap) {
    lines.push(
      `(${errors.length + warnings.length - cap} more — run \`chemag analyze\` for the full list.)`,
    );
  }
  return lines.join("\n");
}
