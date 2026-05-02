import * as path from "node:path";
import { readFileSync } from "node:fs";
import { discoverCompounds, loadCompound, loadWorkspace } from "@chemag/core/loader";
import { checkImports } from "@chemag/core/import-check";
import type { LanguagePlugin } from "@chemag/core/plugin-interface";
import type { Diagnostic, LoadedCompound, ParsedImport, Workspace } from "@chemag/core/types";
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

const R = "\x1b[0m";
const RED = "\x1b[31m";

export function cmdAnalyze(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`\n\x1b[1m${tr("cli.command.analyze")}\x1b[0m\n`);
    console.log(
      "\x1b[1mOptions:\x1b[0m\n" +
        "  --format <fmt>   Output format: human|json|sarif|junit (default: human)\n" +
        "  --json           DEPRECATED. Alias for --format json that preserves the legacy ad-hoc shape. Use --format json instead.\n",
    );
    process.exit(0);
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

  const positional = stripFlags(argv).find((a) => !a.startsWith("-"));
  if (!positional) {
    console.error(`${RED}No workspace file specified.${R}`);
    process.exit(2);
  }

  const wsPath = path.resolve(positional);
  const wsDir = path.dirname(wsPath);
  const manifestCache = createManifestCache(wsDir);
  const importCache = createImportCache(wsDir);

  let ws: Workspace;
  try {
    const raw = readFileSync(wsPath, "utf-8");
    const hash = contentHash(raw);
    const cached = manifestCache.getWorkspace(wsPath, hash);
    if (cached !== null) {
      ws = cached;
    } else {
      ws = loadWorkspace(wsPath);
      manifestCache.setWorkspace(wsPath, ws, hash);
    }
  } catch (e: unknown) {
    console.error(`${RED}Failed to load workspace:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  // Phase 2 — adopt workspace.vocabulary if Phase 1 (cli.ts) didn't already
  // settle on a stronger source. Must run before any tr() output below.
  applyWorkspaceVocabulary(ws);

  let compounds: LoadedCompound[];
  try {
    compounds = discoverCompounds(ws, wsDir, {
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

  const plugin = loadPlugin({ language: ws.language });

  const totalFiles = compounds.reduce((n, c) => n + (c.manifest.units?.length ?? 0), 0);

  const diags = checkImports(ws, compounds, plugin, {
    parseImportsBatch: (filePaths: string[], p: LanguagePlugin) => {
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
    out.push(a);
  }
  return out;
}
