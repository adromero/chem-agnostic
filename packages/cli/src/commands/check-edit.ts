// ---------------------------------------------------------------------------
// `chemag check-edit <file>` — single-file edit validation.
//
// Powers AI-agent hooks and MCP tools. Designed for warm-path latency
// well under 100 ms once the manifest cache (wp-003) is populated.
//
// Exit codes:
//   0  — clean (no diagnostics, or only warnings)
//   1  — diagnostics with at least one error
//   2  — engine failure (workspace not found, invalid args, plugin crash)
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { runCheckEdit, type CheckEditResult } from "@chemag/core/check-edit";
import { discoverCompounds, loadCompound, loadWorkspace } from "@chemag/core/loader";
import type { LoadedCompound, ParsedImport, Workspace } from "@chemag/core/types";
import { applyWorkspaceVocabulary, tr } from "@chemag/core/vocabulary";
import type { LanguagePlugin } from "@chemag/core/plugin-interface";
import { contentHash, createImportCache, createManifestCache } from "@chemag/core/cache";
import { loadPlugin } from "../plugin-loader.js";
import {
  formatDiagnostics,
  isFormatName,
  type FormatContext,
  type FormatName,
} from "../format/index.js";
import { VERSION } from "../version.js";

// Test-overridable stdin reader. Production reads file-descriptor 0 via
// fs.readFileSync(0). Tests inject a fake by calling __setStdinReader().
let stdinReader: () => string = () => readFileSync(0, "utf-8");
export function __setStdinReaderForTesting(fn: () => string): void {
  stdinReader = fn;
}
export function __resetStdinReaderForTesting(): void {
  stdinReader = () => readFileSync(0, "utf-8");
}

const R = "\x1b[0m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

interface ParsedArgs {
  file?: string;
  content?: string; // "-" → read stdin (resolved later)
  workspace?: string;
  format: FormatName;
  /** True if the user passed an unrecognised --format value. */
  formatInvalid?: boolean;
  proposedRole?: string;
  proposedCompound?: string;
  help: boolean;
  /** "claude" → emit a Claude Code PreToolUse hook envelope on stdout. */
  forHook?: "claude";
  /**
   * In `--for-hook claude` mode: "block" (default) → emit
   * `permissionDecision: "deny"` on violation; "warn" → emit "ask".
   * Ignored outside `--for-hook claude` mode.
   */
  mode?: "block" | "warn";
}

export function cmdCheckEdit(argv: string[]): void {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.formatInvalid) {
    console.error(`${RED}Invalid --format value. Expected one of: human, json, sarif, junit${R}`);
    process.exit(2);
  }

  // --for-hook claude takes the file path from stdin JSON
  // (`tool_input.file_path`), not from positional argv. Resolve it here so
  // the rest of the function continues with the same `args.file` contract.
  if (args.forHook === "claude") {
    const resolved = resolveHookStdin();
    if (resolved.kind === "malformed") {
      // Fail-soft: emit `permissionDecision: "allow"` envelope so the agent
      // is never blocked over our parser bugs. Log a stderr warning citing
      // CHEM-INSTALL-HOOKS-006.
      console.error(
        `CHEM-INSTALL-HOOKS-006: ${tr("diagnostic.hook_stdin_unparseable", {
          reason: resolved.reason,
        })}`,
      );
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
          },
        }),
      );
      process.exit(0);
    }
    args.file = resolved.filePath;
  }

  if (!args.file) {
    if (args.forHook === "claude") {
      // Should not happen: resolveHookStdin returns malformed when path is
      // missing. Defensive — emit allow + 006 + exit 0.
      console.error(
        `CHEM-INSTALL-HOOKS-006: ${tr("diagnostic.hook_stdin_unparseable", {
          reason: "missing tool_input.file_path",
        })}`,
      );
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
          },
        }),
      );
      process.exit(0);
    }
    console.error(`${RED}check-edit requires a file argument${R}`);
    console.error("Run 'chemag check-edit --help' for usage.");
    process.exit(2);
  }

  // Resolve workspace. Either an explicit --workspace path (which install-hooks
  // sets to $CLAUDE_PROJECT_DIR for hook invocations), or auto-discover by
  // walking up from the file's directory looking for workspace.yaml.
  // For --workspace, accept either a path to workspace.yaml directly OR a
  // directory containing workspace.yaml — the hook installer passes the
  // project root.
  const wsPath = resolveWorkspacePath(args.workspace, args.file);
  if (!wsPath) {
    if (args.forHook === "claude") {
      // No workspace → silent pass (no envelope). Lets Claude proceed.
      process.exit(0);
    }
    console.error(`${RED}Could not locate workspace.yaml${R} (auto-discovery failed)`);
    console.error("Pass --workspace <path> to specify it explicitly.");
    process.exit(2);
  }
  if (!existsSync(wsPath)) {
    if (args.forHook === "claude") {
      process.exit(0);
    }
    console.error(`${RED}Workspace file not found:${R} ${wsPath}`);
    process.exit(2);
  }

  // For --for-hook claude, if the resolved file is outside the workspace
  // root, exit silently (no envelope) — lets Claude proceed for files we
  // don't manage.
  if (args.forHook === "claude" && args.file) {
    const wsRoot = dirname(wsPath);
    const absFile = resolve(args.file);
    if (!isWithin(absFile, wsRoot)) {
      process.exit(0);
    }
  }

  const wsDir = dirname(wsPath);
  const cache = createManifestCache(wsDir);
  const importCache = createImportCache(wsDir);

  // Load workspace (cache-aware).
  let ws: Workspace;
  try {
    const raw = readFileSync(wsPath, "utf-8");
    const hash = contentHash(raw);
    const cached = cache.getWorkspace(wsPath, hash);
    if (cached !== null) {
      ws = cached;
    } else {
      ws = loadWorkspace(wsPath);
      cache.setWorkspace(wsPath, ws, hash);
    }
  } catch (e: unknown) {
    console.error(`${RED}Failed to load workspace:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  // Phase 2 — adopt workspace.vocabulary if Phase 1 didn't already settle a
  // stronger source. Must run before any tr() output.
  applyWorkspaceVocabulary(ws);

  // Discover compounds (cache-aware).
  let compounds: LoadedCompound[];
  try {
    compounds = discoverCompounds(ws, wsDir, {
      loadCompound: (manifestPath: string): LoadedCompound => {
        const raw = readFileSync(manifestPath, "utf-8");
        const hash = contentHash(raw);
        const cached = cache.getCompound(manifestPath, hash);
        if (cached !== null) return cached;
        const parsed = loadCompound(manifestPath);
        cache.setCompound(manifestPath, parsed, hash);
        return parsed;
      },
    });
  } catch (e: unknown) {
    console.error(`${RED}Failed to discover compounds:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  const plugin = loadPlugin({ language: ws.language });

  // Validate explicit proposal flags (if both supplied).
  if (args.proposedRole !== undefined || args.proposedCompound !== undefined) {
    if (args.proposedRole === undefined || args.proposedCompound === undefined) {
      console.error(`${RED}--proposed-role and --proposed-compound must be supplied together${R}`);
      process.exit(2);
    }
    if (!ws.roles[args.proposedRole]) {
      console.error(
        `${RED}Unknown role:${R} "${args.proposedRole}". Known roles: [${Object.keys(ws.roles).join(", ")}]`,
      );
      process.exit(2);
    }
    if (!compounds.some((c) => c.manifest.compound === args.proposedCompound)) {
      console.error(
        `${RED}Unknown compound:${R} "${args.proposedCompound}". Known: [${compounds
          .map((c) => c.manifest.compound)
          .join(", ")}]`,
      );
      process.exit(2);
    }
  }

  // Resolve --content (stdin or literal).
  let content: string | undefined;
  if (args.content === "-") {
    try {
      content = stdinReader();
    } catch (e: unknown) {
      console.error(
        `${RED}Failed to read stdin for --content -:${R} ${e instanceof Error ? e.message : e}`,
      );
      process.exit(2);
    }
  } else if (args.content !== undefined) {
    content = args.content;
  }

  // Cache-aware import parser hook (warm path uses content hash → cache).
  const parseImportsForFile = (filePath: string, plugin: LanguagePlugin): ParsedImport[] => {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const h = contentHash(raw);
      const cached = importCache.get(filePath, h);
      if (cached !== null) return cached;
      const parsed = plugin.parseImports(filePath);
      importCache.set(filePath, parsed, h);
      return parsed;
    } catch {
      // File may not exist on disk (proposed new file with --content).
      // Fall through to the plugin, which the engine will route via the
      // temp-file path.
      return plugin.parseImports(filePath);
    }
  };

  let result: CheckEditResult;
  try {
    result = runCheckEdit({
      workspace: ws,
      workspaceDir: wsDir,
      compounds,
      plugin,
      filePath: args.file,
      content,
      proposedRole: args.proposedRole,
      proposedCompound: args.proposedCompound,
      parseImportsForFile,
    });
  } catch (e: unknown) {
    console.error(`${RED}check-edit failed:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  if (args.forHook === "claude") {
    emitClaudeHookEnvelope(result, args.mode ?? "block");
    process.exit(0);
  }

  emitResult(result, args.format, wsDir, ws.workspace);

  const hasError = result.diagnostics.some((d) => d.level === "error");
  process.exit(hasError ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Claude Code hook envelope (PreToolUse)
// ---------------------------------------------------------------------------

interface PreToolUseEnvelope {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
  };
}

/**
 * Emit the Claude Code PreToolUse hook envelope on stdout. When there are no
 * error-level diagnostics we omit the envelope entirely so Claude proceeds
 * without prompting (the spec calls this the "allow-omit" path).
 */
function emitClaudeHookEnvelope(result: CheckEditResult, mode: "block" | "warn"): void {
  const errors = result.diagnostics.filter((d) => d.level === "error");
  if (errors.length === 0) {
    // No envelope — Claude proceeds without prompting.
    return;
  }

  const decision: "deny" | "ask" = mode === "warn" ? "ask" : "deny";
  const reason = formatHookReason(result, errors);

  const envelope: PreToolUseEnvelope = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
  console.log(JSON.stringify(envelope));
}

/**
 * Build the human-readable reason shown to the model. Includes diagnostic
 * codes so the model can self-correct (and so users can grep for the code in
 * Claude's chat output).
 */
function formatHookReason(result: CheckEditResult, errors: CheckEditResult["diagnostics"]): string {
  const compoundPart = result.compound ? ` (compound: ${result.compound}` : "";
  const rolePart = result.role ? `, role: ${result.role})` : result.compound ? ")" : "";
  const header = `chemag check-edit found ${errors.length} error(s) in ${result.file}${compoundPart}${rolePart}`;

  const lines = errors.map((d) => {
    const code = d.code ?? "CHEM-???";
    return `- [${code}] ${d.message}`;
  });

  return `${header}\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Workspace path resolution (shared with --for-hook claude)
// ---------------------------------------------------------------------------

/**
 * Resolve `--workspace` to an absolute workspace.yaml path. Accepts:
 *   - undefined → walk up from the (possibly proposed) file
 *   - a workspace.yaml path
 *   - a directory containing workspace.yaml
 *
 * Returns null if no workspace can be found.
 */
function resolveWorkspacePath(
  workspace: string | undefined,
  file: string | undefined,
): string | null {
  if (workspace !== undefined) {
    const abs = resolve(workspace);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      const cand = resolve(abs, "workspace.yaml");
      return existsSync(cand) ? cand : null;
    }
    return abs;
  }
  if (file === undefined) return null;
  return findWorkspaceUp(resolve(file));
}

/** True if `target` is contained within `root` (or equal to it). */
function isWithin(target: string, root: string): boolean {
  const normTarget = resolve(target);
  const normRoot = resolve(root);
  if (normTarget === normRoot) return true;
  return normTarget.startsWith(`${normRoot}/`) || normTarget.startsWith(`${normRoot}\\`);
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

/**
 * `check-edit --format json` retains the wp-004 single-file shape (which is
 * what the `check-edit-result.schema.json` documents). Other formats route
 * through the shared dispatcher.
 *
 * The wp-004 JSON shape is canonical for check-edit because consumers
 * (editor hooks, MCP tools) depend on the file/compound/role envelope.
 * The new schema-validated diagnostics envelope from wp-005 covers
 * workspace-level outputs (check, analyze) — for check-edit it would
 * lose information.
 */
function emitResult(
  result: CheckEditResult,
  format: FormatName,
  workspaceDir: string,
  workspaceName: string,
): void {
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const ctx: FormatContext = {
    workspaceName,
    workspacePath: workspaceDir,
    command: "check-edit",
    toolVersion: VERSION,
    fileContext: {
      file: result.file,
      compound: result.compound,
      role: result.role,
    },
  };

  const out = formatDiagnostics(result.diagnostics, format, ctx);
  console.log(out.endsWith("\n") ? out.slice(0, -1) : out);
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { format: "human", help: false };

  const setFormat = (v: string | undefined): void => {
    if (v === undefined) {
      out.formatInvalid = true;
      return;
    }
    if (isFormatName(v)) {
      out.format = v;
    } else {
      out.formatInvalid = true;
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "--content":
        out.content = argv[++i];
        break;
      case "--workspace":
        out.workspace = argv[++i];
        break;
      case "--format":
        setFormat(argv[++i]);
        break;
      case "--proposed-role":
        out.proposedRole = argv[++i];
        break;
      case "--proposed-compound":
        out.proposedCompound = argv[++i];
        break;
      case "--for-hook": {
        const v = argv[++i];
        if (v === "claude") out.forHook = "claude";
        // Other values are silently ignored — future hosts add their own
        // values without breaking the current ABI.
        break;
      }
      case "--mode": {
        const v = argv[++i];
        if (v === "block" || v === "warn") out.mode = v;
        break;
      }
      default:
        if (a.startsWith("--content=")) {
          out.content = a.slice("--content=".length);
        } else if (a.startsWith("--workspace=")) {
          out.workspace = a.slice("--workspace=".length);
        } else if (a.startsWith("--format=")) {
          setFormat(a.slice("--format=".length));
        } else if (a.startsWith("--proposed-role=")) {
          out.proposedRole = a.slice("--proposed-role=".length);
        } else if (a.startsWith("--proposed-compound=")) {
          out.proposedCompound = a.slice("--proposed-compound=".length);
        } else if (a.startsWith("--for-hook=")) {
          const v = a.slice("--for-hook=".length);
          if (v === "claude") out.forHook = "claude";
        } else if (a.startsWith("--mode=")) {
          const v = a.slice("--mode=".length);
          if (v === "block" || v === "warn") out.mode = v;
        } else if (!a.startsWith("-") && out.file === undefined) {
          out.file = a;
        }
        break;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Hook stdin reader
// ---------------------------------------------------------------------------

/**
 * Result of attempting to read + parse the Claude Code hook stdin envelope.
 * Successful: { kind: "ok", filePath }. Otherwise malformed (caller emits
 * `permissionDecision: "allow"` + CHEM-INSTALL-HOOKS-006 stderr warning).
 */
type HookStdinResult = { kind: "ok"; filePath: string } | { kind: "malformed"; reason: string };

function resolveHookStdin(): HookStdinResult {
  let raw: string;
  try {
    raw = stdinReader();
  } catch (e) {
    return {
      kind: "malformed",
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      kind: "malformed",
      reason: e instanceof Error ? e.message : "invalid JSON",
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "malformed", reason: "stdin JSON is not an object" };
  }

  const obj = parsed as Record<string, unknown>;
  const toolInput = obj.tool_input;
  if (typeof toolInput !== "object" || toolInput === null) {
    return { kind: "malformed", reason: "missing tool_input" };
  }
  const filePath = (toolInput as Record<string, unknown>).file_path;
  if (typeof filePath !== "string" || filePath === "") {
    return { kind: "malformed", reason: "missing tool_input.file_path" };
  }
  return { kind: "ok", filePath };
}

// ---------------------------------------------------------------------------
// Workspace auto-discovery
// ---------------------------------------------------------------------------

/**
 * Walk up from `from` looking for `workspace.yaml`. `from` may be a file
 * path (existing or proposed) or a directory. Returns the absolute path
 * when found, null otherwise.
 */
function findWorkspaceUp(from: string): string | null {
  const start = isAbsolute(from) ? from : resolve(from);
  let dir: string;
  if (existsSync(start)) {
    dir = statSync(start).isDirectory() ? start : dirname(start);
  } else {
    // Path doesn't exist — assume it's a (proposed) file path and start
    // from its parent directory.
    dir = dirname(start);
  }

  let lastDir: string | null = null;
  while (dir && dir !== lastDir) {
    const candidate = resolve(dir, "workspace.yaml");
    if (existsSync(candidate)) return candidate;
    lastDir = dir;
    dir = dirname(dir);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`\n${BLD}check-edit — validate a single file edit${R}\n`);
  console.log(`${BLD}Usage:${R}`);
  console.log("  chemag check-edit <file> [--content <string|->] [--workspace <path>]");
  console.log("                     [--format human|json|sarif|junit]");
  console.log("                     [--proposed-role <role>] [--proposed-compound <name>]");
  console.log();
  console.log(`${BLD}Options:${R}`);
  console.log("  --content <s|->        Hypothetical new content. Use '-' to read stdin.");
  console.log("  --workspace <path>     Explicit workspace.yaml path (default: auto-discover).");
  console.log("  --format <fmt>         Output format: human|json|sarif|junit. Default: human.");
  console.log("  --proposed-role <r>    Role to assume for files not yet in any manifest.");
  console.log("  --proposed-compound <n>  Compound to assume.");
  console.log();
  console.log(`${BLD}Exit codes:${R}`);
  console.log("  0  clean (no errors)");
  console.log("  1  one or more error diagnostics");
  console.log("  2  engine failure (bad args, missing workspace, plugin crash)");
  console.log();
  // Acknowledge that `tr()` is locale-aware for the top-level command help
  // entry — kept short to avoid duplicating the option list.
  console.log(`${DIM}${tr("cli.command.check")}${R}\n`);
}
