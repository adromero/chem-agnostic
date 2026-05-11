import * as path from "node:path";
import { allChecks } from "@chemag/core/checks";
import { explainCode } from "@chemag/core/diagnostics";
import {
  discoverCompoundsBySubtree,
  loadCompound,
  loadWorkspaceWithDiagnostics,
} from "@chemag/core/loader";
import type {
  CheckOptions,
  Diagnostic,
  LanguageSubtree,
  LoadedCompound,
  Workspace,
} from "@chemag/core/types";
import { applyWorkspaceVocabulary, tr } from "@chemag/core/vocabulary";
import { emit as emitTelemetry } from "@chemag/telemetry";
import { readFileSync } from "node:fs";
import { contentHash, createManifestCache } from "@chemag/core/cache";
import { loadPlugin } from "../plugin-loader.js";
import {
  formatDiagnostics,
  isFormatName,
  type FormatContext,
  type FormatName,
} from "../format/index.js";
import { VERSION } from "../version.js";

const R = "\x1b[0m";
const RED = "\x1b[31m";

export function cmdCheck(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`\n\x1b[1m${tr("cli.command.check")}\x1b[0m\n`);
    console.log(
      "\x1b[1mOptions:\x1b[0m\n" +
        "  --manifest-only       Skip filesystem checks\n" +
        "  --verbose, -v         Show warning details\n" +
        "  --format <fmt>        Output format: human|json|sarif|junit (default: human)\n" +
        "  --json                DEPRECATED. Alias for --format json that preserves the legacy ad-hoc shape. Use --format json instead.\n" +
        "  --explain CHEM-XXX-NNN  Print metadata for a diagnostic code and exit\n",
    );
    process.exit(0);
  }

  // --explain is a query flag — short-circuit BEFORE any workspace resolution
  // so `chemag check --explain CHEM-BOND-001` works without a workspace path.
  // The naive positional scan below (`argv.find(a => !a.startsWith("-"))`)
  // would otherwise misread the code argument as the workspace path.
  const explainIdx = argv.indexOf("--explain");
  if (explainIdx !== -1) {
    const code = argv[explainIdx + 1];
    if (!code) {
      console.error(`${RED}--explain requires a code argument (e.g. CHEM-BOND-001)${R}`);
      process.exit(2);
    }
    const out = explainCode(code);
    if (out === null) {
      console.error(`${RED}Unknown diagnostic code:${R} ${code}`);
      process.exit(2);
    }
    console.log(out);
    process.exit(0);
  }

  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const legacyJson = argv.includes("--json");
  const manifestOnly = argv.includes("--manifest-only");

  // Resolve --format (mutually exclusive with --json).
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

  // Strip flags before searching for the positional workspace argument.
  const positional = stripFlags(argv).find((a) => !a.startsWith("-"));
  if (!positional) {
    console.error(`${RED}No workspace file specified.${R}`);
    process.exit(2);
  }

  const wsPath = path.resolve(positional);
  const wsDir = path.dirname(wsPath);
  const cache = createManifestCache(wsDir);

  let ws: Workspace;
  // Loader diagnostics (CHEM-MANIFEST-005 today; reserved for future
  // recoverable manifest-shape diagnostics) surface alongside the
  // `allChecks` output. They're cached alongside the workspace by content
  // hash so cache hits replay them.
  let loaderDiagnostics: Diagnostic[] = [];
  try {
    const raw = readFileSync(wsPath, "utf-8");
    const hash = contentHash(raw);
    const cached = cache.getWorkspaceWithDiagnostics(wsPath, hash);
    if (cached !== null) {
      ws = cached.workspace;
      loaderDiagnostics = cached.diagnostics;
    } else {
      const result = loadWorkspaceWithDiagnostics(wsPath);
      ws = result.workspace;
      loaderDiagnostics = result.diagnostics;
      cache.setWorkspaceWithDiagnostics(wsPath, ws, loaderDiagnostics, hash);
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

  // WP-020: load one plugin per sub-tree. The per-sub-tree plugin contributes
  // its default public-surface filename (used as a fallback when neither
  // workspace.rules.public_surface nor sub.public_surface is set).
  const subtreePlugins = groups.map((g) => ({
    scope: g.scope,
    compounds: g.compounds,
    plugin: loadPlugin({ language: g.scope.language }),
  }));
  const compounds: LoadedCompound[] = subtreePlugins.flatMap((g) => g.compounds);

  // Stats
  const byType: Record<string, number> = {};
  for (const c of compounds) {
    const t = c.manifest.type ?? "compound";
    byType[t] = (byType[t] ?? 0) + 1;
  }
  const totalUnits = compounds.reduce((n, c) => n + (c.manifest.units?.length ?? 0), 0);
  const totalAssays = compounds.reduce((n, c) => n + (c.manifest.assays?.length ?? 0), 0);

  // Workspace-wide checks (no-duplicates, role-folder mismatches, signal
  // emitter resolution, ...) need to see ALL compounds so cross-sub-tree
  // duplicates are caught. We run `allChecks` ONCE on the union list, using
  // the primary sub-tree's plugin defaults — workspace.rules.public_surface
  // takes precedence anyway, and per-sub-tree public-surface overrides flow
  // through `discoverCompoundsBySubtree` below.
  const primaryPlugin = subtreePlugins[0]?.plugin;
  const baseOpts: CheckOptions = {
    manifestOnly,
    defaultPublicSurface: primaryPlugin?.defaults.publicSurface,
  };
  let totalErrors = 0;
  let totalWarnings = 0;
  let passed = 0;
  let failed = 0;
  const results: { check: string; diagnostics: Diagnostic[] }[] = [];
  const allDiags: Diagnostic[] = [];

  // Loader-phase diagnostics are folded in as a virtual "manifest-loader"
  // check entry so the per-check summary and totals reflect them.
  if (loaderDiagnostics.length > 0) {
    results.push({ check: "manifest-loader", diagnostics: loaderDiagnostics });
    allDiags.push(...loaderDiagnostics);
    const lErrs = loaderDiagnostics.filter((d) => d.level === "error").length;
    const lWarns = loaderDiagnostics.filter((d) => d.level === "warning").length;
    totalErrors += lErrs;
    totalWarnings += lWarns;
    if (lErrs > 0) failed++;
    else passed++;
  }

  for (const { name, fn } of allChecks) {
    const diags = fn(ws, compounds, baseOpts);

    // Re-run the public-surface check per sub-tree when the workspace has
    // multiple language sub-trees with differing publicSurface defaults —
    // each sub-tree may use a different filename (`public.ts` for TS,
    // `__init__.py` for Python). We REPLACE the workspace-wide diagnostics
    // for this specific check with the per-sub-tree results.
    let merged = diags;
    if (
      name === "public-surface" &&
      subtreePlugins.length > 1 &&
      ws.rules?.public_surface === undefined &&
      !manifestOnly
    ) {
      merged = [];
      for (const g of subtreePlugins) {
        const subOpts: CheckOptions = {
          manifestOnly,
          defaultPublicSurface: g.scope.public_surface ?? g.plugin.defaults.publicSurface,
        };
        const subDiags = fn(ws, g.compounds, subOpts).map((d) => ({
          ...d,
          language_id: d.language_id ?? g.scope.id,
        }));
        merged.push(...subDiags);
      }
    }

    results.push({ check: name, diagnostics: merged });
    allDiags.push(...merged);

    const errors = merged.filter((d) => d.level === "error");
    const warnings = merged.filter((d) => d.level === "warning");
    totalErrors += errors.length;
    totalWarnings += warnings.length;

    if (errors.length > 0) {
      failed++;
    } else {
      passed++;
    }
  }

  // Legacy --json emits the EXISTING ad-hoc shape for backward compatibility.
  // The new schema-validated shape is only emitted under --format json.
  if (legacyJson) {
    console.log(
      JSON.stringify(
        {
          workspace: ws.workspace,
          compounds: compounds.length,
          units: totalUnits,
          assays: totalAssays,
          errors: totalErrors,
          warnings: totalWarnings,
          checks: results.map(({ check, diagnostics }) => ({
            check,
            passed: diagnostics.filter((d) => d.level === "error").length === 0,
            diagnostics,
          })),
        },
        null,
        2,
      ),
    );
    emitViolations(allDiags);
    process.exit(totalErrors > 0 ? 1 : 0);
  }

  // Modern path — dispatch through formatDiagnostics.
  const ctx: FormatContext = {
    workspaceName: ws.workspace,
    workspacePath: wsDir,
    command: "check",
    toolVersion: VERSION,
    totals: {
      compounds: compounds.length,
      units: totalUnits,
      assays: totalAssays,
      passed,
      failed,
    },
    checks: results,
    verbose,
    manifestOnly,
  };

  // Use console.log so existing tests (which spy on it) still capture
  // output. The formatter strings end with a trailing newline; trim it
  // since console.log appends its own.
  const out = formatDiagnostics(allDiags, resolvedFormat, ctx);
  console.log(out.endsWith("\n") ? out.slice(0, -1) : out);

  // Fire-and-forget cli.violations.found (no file paths in payload). Safe
  // because the call is a no-op when telemetry consent is not granted.
  emitViolations(allDiags);

  process.exit(totalErrors > 0 ? 1 : 0);
}

/**
 * Emit `cli.violations.found` per 09-cross-cutting.md: count + check_kinds[]
 * derived from each Diagnostic.code's middle segment (e.g. `CHEM-BOND-001` →
 * `BOND`). NO file paths or content. Fire-and-forget; awaiting would block
 * the CLI exit and the no-consent path is already a no-op.
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

/**
 * Parse `--format <name>` / `--format=<name>`. Returns the resolved
 * FormatName, the literal `"__invalid__"` if a value was passed but is not
 * one of human/json/sarif/junit, or null if the flag was absent.
 */
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

/**
 * Strip --format / --format=<v> / --json / --verbose / --manifest-only /
 * --explain (and its value) from argv so the remaining tokens contain only
 * the positional workspace argument.
 */
function stripFlags(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format" || a === "--explain") {
      i++; // skip value too
      continue;
    }
    if (a.startsWith("--format=")) continue;
    if (a === "--json") continue;
    if (a === "--verbose" || a === "-v") continue;
    if (a === "--manifest-only") continue;
    out.push(a);
  }
  return out;
}
