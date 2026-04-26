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
import {
  runCheckEdit,
  type CheckEditDiagnostic,
  type CheckEditResult,
} from "@chemag/core/check-edit";
import { discoverCompounds, loadCompound, loadWorkspace } from "@chemag/core/loader";
import type { LoadedCompound, ParsedImport, Workspace } from "@chemag/core/types";
import { applyWorkspaceVocabulary, tr } from "@chemag/core/vocabulary";
import type { LanguagePlugin } from "@chemag/core/plugin-interface";
import { contentHash } from "../cache/content-hash.js";
import { createImportCache } from "../cache/import-cache.js";
import { createManifestCache } from "../cache/manifest-cache.js";
import { loadPlugin } from "../plugin-loader.js";

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
const GRN = "\x1b[32m";
const YEL = "\x1b[33m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

interface ParsedArgs {
  file?: string;
  content?: string; // "-" → read stdin (resolved later)
  workspace?: string;
  format: "human" | "json";
  proposedRole?: string;
  proposedCompound?: string;
  help: boolean;
}

export function cmdCheckEdit(argv: string[]): void {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.file) {
    console.error(`${RED}check-edit requires a file argument${R}`);
    console.error("Run 'chemag check-edit --help' for usage.");
    process.exit(2);
  }

  // Resolve workspace. Either an explicit --workspace path, or auto-discover
  // by walking up from the file's directory looking for workspace.yaml.
  const wsPath = args.workspace ? resolve(args.workspace) : findWorkspaceUp(resolve(args.file));
  if (!wsPath) {
    console.error(`${RED}Could not locate workspace.yaml${R} (auto-discovery failed)`);
    console.error("Pass --workspace <path> to specify it explicitly.");
    process.exit(2);
  }
  if (!existsSync(wsPath)) {
    console.error(`${RED}Workspace file not found:${R} ${wsPath}`);
    process.exit(2);
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

  emitResult(result, args.format);

  const hasError = result.diagnostics.some((d) => d.level === "error");
  process.exit(hasError ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function emitResult(result: CheckEditResult, format: "human" | "json"): void {
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Human format mirrors `chem check`.
  console.log(`\n${BLD}chemag check-edit${R}\n`);
  console.log(`${BLD}File:${R} ${result.file}`);
  if (result.compound) console.log(`${BLD}Compound:${R} ${result.compound}`);
  if (result.role) console.log(`${BLD}Role:${R} ${result.role}`);
  console.log();

  const errors = result.diagnostics.filter((d) => d.level === "error");
  const warnings = result.diagnostics.filter((d) => d.level === "warning");

  if (result.diagnostics.length === 0) {
    console.log(`  ${GRN}✓${R}  no diagnostics\n`);
    return;
  }

  for (const d of result.diagnostics) {
    formatDiagnostic(d);
  }

  console.log();
  if (errors.length > 0) {
    const w = warnings.length ? `, ${warnings.length} warning(s)` : "";
    console.log(`${RED}${BLD}${errors.length} error${errors.length !== 1 ? "s" : ""}${w}${R}\n`);
  } else {
    console.log(`${YEL}${BLD}${warnings.length} warning${warnings.length !== 1 ? "s" : ""}${R}\n`);
  }
}

function formatDiagnostic(d: CheckEditDiagnostic): void {
  const color = d.level === "error" ? RED : YEL;
  console.log(`  ${color}${d.level}${R} ${DIM}[${d.code}]${R} ${d.message}`);
  if (d.imported_module) {
    console.log(`    ${DIM}imports ${d.imported_module}${R}`);
  }
  if (d.hint) console.log(`    ${DIM}${d.hint}${R}`);
  if (d.remediation) {
    console.log(`    ${DIM}remediation: ${d.remediation.kind}${R}`);
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { format: "human", help: false };

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
        out.format = argv[++i] === "json" ? "json" : "human";
        break;
      case "--proposed-role":
        out.proposedRole = argv[++i];
        break;
      case "--proposed-compound":
        out.proposedCompound = argv[++i];
        break;
      default:
        if (a.startsWith("--content=")) {
          out.content = a.slice("--content=".length);
        } else if (a.startsWith("--workspace=")) {
          out.workspace = a.slice("--workspace=".length);
        } else if (a.startsWith("--format=")) {
          const v = a.slice("--format=".length);
          out.format = v === "json" ? "json" : "human";
        } else if (a.startsWith("--proposed-role=")) {
          out.proposedRole = a.slice("--proposed-role=".length);
        } else if (a.startsWith("--proposed-compound=")) {
          out.proposedCompound = a.slice("--proposed-compound=".length);
        } else if (!a.startsWith("-") && out.file === undefined) {
          out.file = a;
        }
        break;
    }
  }

  return out;
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
  console.log("                     [--format json|human]");
  console.log("                     [--proposed-role <role>] [--proposed-compound <name>]");
  console.log();
  console.log(`${BLD}Options:${R}`);
  console.log("  --content <s|->        Hypothetical new content. Use '-' to read stdin.");
  console.log("  --workspace <path>     Explicit workspace.yaml path (default: auto-discover).");
  console.log("  --format json|human    Output format. Default: human.");
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
