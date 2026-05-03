// ---------------------------------------------------------------------------
// `chemag emit-rules` — generate compact AI-editor rule files from
// workspace.yaml. See packages/core/src/rules-emitters for the per-tool
// renderers.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { allChecks } from "@chemag/core/checks";
import { discoverCompounds, loadCompound, loadWorkspace } from "@chemag/core/loader";
import type { LanguagePlugin } from "@chemag/core/plugin-interface";
import {
  buildRulesContent,
  emitClaudeMd,
  emitRules as emitRulesOne,
  MarkersMissingError,
  mergeBetweenMarkers,
  SUPPORTED_TOOLS,
  type EmittedFile,
  type EmitterTool,
  type RulesContent,
} from "@chemag/core/rules-emitters";
import type { CheckOptions, Diagnostic, LoadedCompound, Workspace } from "@chemag/core/types";
import { applyWorkspaceVocabulary, tr } from "@chemag/core/vocabulary";
import { emit as emitTelemetry } from "@chemag/telemetry";
import { loadPlugin } from "../plugin-loader.js";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const YLW = "\x1b[33m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

/** Tool aliases. `codex` reads AGENTS.md by convention. */
const TOOL_ALIASES: Record<string, EmitterTool | "all"> = {
  claude: "claude",
  agents: "agents",
  codex: "agents", // alias per spec
  cursor: "cursor",
  copilot: "copilot",
  aider: "aider",
  cline: "cline",
  all: "all",
};

interface ParsedArgs {
  tool: EmitterTool | "all";
  toolArg: string; // raw value for diagnostics
  workspace: string;
  outDir: string | null;
  maxLines: number | null;
  includeViolations: boolean;
  dryRun: boolean;
  diff: boolean;
  overwrite: boolean;
}

export function cmdEmitRules(argv: string[]): number {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`\n${BLD}${tr("cli.command.emit_rules")}${R}\n`);
    console.log(
      `${BLD}Options:${R}\n  --tool <name>            One of claude|agents|codex|cursor|copilot|aider|cline|all (default: all)\n  --workspace <path>       Path to workspace.yaml (default: ./workspace.yaml)\n  --out-dir <path>         Output base directory (default: workspace dir)\n  --max-lines <n>          Override default per-tool line budget\n  --include-violations     Embed current chemag violations as fix-me hints\n  --dry-run                Print planned actions without writing files\n  --diff                   Print unified diff per file that would change\n  --overwrite              Allow replacing files without chemag markers\n`,
    );
    return 0;
  }

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    console.error(`${RED}${(e as Error).message}${R}`);
    return 2;
  }

  // Validate the --tool value against the alias table BEFORE doing any work.
  if (TOOL_ALIASES[parsed.toolArg] === undefined) {
    const supported = Object.keys(TOOL_ALIASES).join(", ");
    const code = "CHEM-EMIT-RULES-003";
    console.error(
      `${RED}${code}:${R} ${tr("diagnostic.unknown_emitter_tool", {
        tool: parsed.toolArg,
        supported,
      })}`,
    );
    return 2;
  }

  const wsPath = path.resolve(parsed.workspace);
  if (!fs.existsSync(wsPath)) {
    console.error(`${RED}Workspace file not found:${R} ${wsPath}`);
    return 2;
  }

  let ws: Workspace;
  try {
    ws = loadWorkspace(wsPath);
  } catch (e) {
    console.error(`${RED}Failed to load workspace:${R} ${(e as Error).message}`);
    return 2;
  }
  applyWorkspaceVocabulary(ws);

  const wsDir = path.dirname(wsPath);
  const outDir = parsed.outDir === null ? wsDir : path.resolve(parsed.outDir);

  // WP-020: iterate ws.languages here for true multi-plugin runs.
  const plugin = loadPlugin({ language: ws.language });

  let compounds: LoadedCompound[] = [];
  try {
    compounds = discoverCompounds(ws, wsDir, { loadCompound });
  } catch (e) {
    console.error(`${YLW}warning: failed to discover compounds:${R} ${(e as Error).message}`);
    compounds = [];
  }

  // Gather diagnostics for --include-violations. Only run the pipeline when
  // the flag is set so the default path stays cheap.
  let violations: Diagnostic[] | undefined;
  if (parsed.includeViolations) {
    const opts: CheckOptions = {
      manifestOnly: false,
      defaultPublicSurface: plugin.defaults.publicSurface,
    };
    const collected: Diagnostic[] = [];
    for (const { fn } of allChecks) {
      collected.push(...fn(ws, compounds, opts));
    }
    violations = collected;
  }

  const content = buildRulesContent(ws, compounds, { violations });

  const tools: EmitterTool[] = parsed.tool === "all" ? [...SUPPORTED_TOOLS] : [parsed.tool];

  const renderOpts = parsed.maxLines === null ? {} : { maxLines: parsed.maxLines };
  const rendered = new Map<EmitterTool, EmittedFile>();
  for (const tool of tools) {
    rendered.set(tool, renderOne(tool, content, plugin, renderOpts));
  }

  console.log(`\n${BLD}chemag emit-rules${R}${parsed.dryRun ? ` ${DIM}(dry run)${R}` : ""}\n`);

  let exitCode = 0;
  for (const tool of tools) {
    const file = rendered.get(tool);
    if (file === undefined) continue;
    const targetPath = path.join(outDir, file.path);

    // Surface budget warnings as CHEM-EMIT-RULES-002 (warning level).
    for (const w of file.warnings) {
      console.warn(`${YLW}CHEM-EMIT-RULES-002:${R} ${w}`);
    }

    let existing: string | null = null;
    if (fs.existsSync(targetPath)) {
      existing = fs.readFileSync(targetPath, "utf-8");
    }

    let merged: string;
    try {
      const result = mergeBetweenMarkers(existing, file.block, {
        overwrite: parsed.overwrite,
        isMdc: tool === "cursor",
        leading: file.leading,
        trailing: file.trailing,
      });
      merged = result.body;
      for (const w of result.warnings) console.warn(`${YLW}warning:${R} ${w}`);
    } catch (e) {
      if (e instanceof MarkersMissingError) {
        const code = "CHEM-EMIT-RULES-001";
        console.error(
          `${RED}${code}:${R} ${tr("diagnostic.markers_missing_no_overwrite", {
            path: targetPath,
          })}`,
        );
        exitCode = 1;
        continue;
      }
      throw e;
    }

    if (parsed.diff) {
      const diffOut = unifiedDiff(existing ?? "", merged, targetPath);
      if (diffOut !== "") {
        console.log(diffOut);
      }
      continue;
    }

    if (parsed.dryRun) {
      const action = existing === null ? "create" : merged === existing ? "no-op" : "update";
      console.log(`  ${DIM}${action}${R}  ${path.relative(wsDir, targetPath)}`);
      continue;
    }

    if (existing === merged) {
      console.log(`  ${DIM}=  ${path.relative(wsDir, targetPath)} (unchanged)${R}`);
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, merged, "utf-8");
    const verb = existing === null ? "+" : "~";
    console.log(`  ${GRN}${verb}${R}  ${path.relative(wsDir, targetPath)}`);
  }

  if (!parsed.dryRun && exitCode === 0) {
    void emitTelemetry("cli.command.emit_rules", {
      tool: parsed.tool,
      out_dir: path.relative(wsDir, outDir) || ".",
      tools_count: tools.length,
    }).catch(() => {});
  }

  return exitCode;
}

// ---------------------------------------------------------------------------
// Per-tool render helpers
// ---------------------------------------------------------------------------

function renderOne(
  tool: EmitterTool,
  content: RulesContent,
  plugin: LanguagePlugin,
  options: { maxLines?: number },
): EmittedFile {
  if (tool === "claude") {
    const pluginContent = plugin.generateClaudeMd(content.workspaceName);
    return emitClaudeMd(content, {
      pluginContent,
      ...options,
    });
  }
  return emitRulesOne(content, tool, options);
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): ParsedArgs {
  let tool = "all";
  let workspace = "./workspace.yaml";
  let outDir: string | null = null;
  let maxLines: number | null = null;
  let includeViolations = false;
  let dryRun = false;
  let diff = false;
  let overwrite = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--tool":
        tool = argv[++i] ?? "";
        break;
      case "--workspace":
        workspace = argv[++i] ?? workspace;
        break;
      case "--out-dir":
        outDir = argv[++i] ?? null;
        break;
      case "--max-lines": {
        const next = argv[++i];
        if (next === undefined) throw new Error("--max-lines requires a value");
        const n = Number(next);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(`--max-lines must be a positive integer, got "${next}"`);
        }
        maxLines = Math.floor(n);
        break;
      }
      case "--include-violations":
        includeViolations = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--diff":
        diff = true;
        break;
      case "--overwrite":
        overwrite = true;
        break;
      default:
        if (a.startsWith("--tool=")) {
          tool = a.slice("--tool=".length);
        } else if (a.startsWith("--workspace=")) {
          workspace = a.slice("--workspace=".length);
        } else if (a.startsWith("--out-dir=")) {
          outDir = a.slice("--out-dir=".length);
        } else if (a.startsWith("--max-lines=")) {
          const n = Number(a.slice("--max-lines=".length));
          if (!Number.isFinite(n) || n <= 0) {
            throw new Error(`--max-lines must be a positive integer, got "${a}"`);
          }
          maxLines = Math.floor(n);
        } else if (a.startsWith("-")) {
          throw new Error(`Unknown flag: ${a}`);
        }
        // Positional args silently ignored — emit-rules takes none.
        break;
    }
  }

  return {
    tool: TOOL_ALIASES[tool] ?? (tool as EmitterTool | "all"),
    toolArg: tool,
    workspace,
    outDir,
    maxLines,
    includeViolations,
    dryRun,
    diff,
    overwrite,
  };
}

/**
 * Tiny unified-diff renderer. Sufficient for `--diff` output without
 * pulling in a dependency. Two tradeoffs:
 *   1. We emit one big hunk rather than separate hunks per change region —
 *      acceptable because rule files are small (<100 lines).
 *   2. Context lines are not deduplicated. Again fine at this scale.
 */
function unifiedDiff(before: string, after: string, label: string): string {
  if (before === after) return "";
  const beforeLines = before === "" ? [] : before.split("\n");
  const afterLines = after === "" ? [] : after.split("\n");
  const out: string[] = [];
  out.push(`--- ${label}`);
  out.push(`+++ ${label}`);
  for (const line of beforeLines) out.push(`-${line}`);
  for (const line of afterLines) out.push(`+${line}`);
  return out.join("\n");
}
