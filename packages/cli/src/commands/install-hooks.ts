// ---------------------------------------------------------------------------
// `chemag install-hooks` — install / uninstall AI-editor hook integrations.
//
// In WP-010 only the `--tool claude` path is implemented; other tools error
// with `CHEM-INSTALL-HOOKS-001 not_yet_implemented` (Track 1's WP-011..WP-013
// fill these in).
//
// Surface:
//   chemag install-hooks --tool <claude|cursor|codex|aider|cline|copilot|all>
//                        [--scope user|project]                default: project
//                        [--mode block|warn|context-only]       default: block
//                        [--uninstall]
//                        [--restore]
//                        [--dry-run]
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { tr } from "@chemag/core/vocabulary";
import { emit as emitTelemetry } from "@chemag/telemetry";
import {
  getClaudeSettingsPath,
  installClaudeCode,
  isAlreadyInstalled,
  SettingsParseError,
  uninstallClaudeCode,
  type InstallMode,
  type InstallScope,
} from "../installers/claude-code.js";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const YLW = "\x1b[33m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

// All recognized tool names. Currently only `claude` is implemented.
const KNOWN_TOOLS = new Set(["claude", "cursor", "codex", "aider", "cline", "copilot", "all"]);

interface ParsedArgs {
  tool: string;
  scope: InstallScope;
  mode: InstallMode;
  uninstall: boolean;
  restore: boolean;
  dryRun: boolean;
  workspace: string;
  help: boolean;
}

export function cmdInstallHooks(argv: string[]): number {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    console.error(`${RED}${(e as Error).message}${R}`);
    return 2;
  }

  if (parsed.help) {
    printHelp();
    return 0;
  }

  if (!KNOWN_TOOLS.has(parsed.tool)) {
    const code = "CHEM-INSTALL-HOOKS-001";
    console.error(
      `${RED}${code}:${R} ${tr("diagnostic.tool_not_yet_implemented", { tool: parsed.tool })}`,
    );
    return 2;
  }

  // Currently only the claude path is implemented; all/everything else
  // emits CHEM-INSTALL-HOOKS-001 until WP-011..WP-013 land.
  if (parsed.tool !== "claude") {
    const code = "CHEM-INSTALL-HOOKS-001";
    console.error(
      `${RED}${code}:${R} ${tr("diagnostic.tool_not_yet_implemented", { tool: parsed.tool })}`,
    );
    return 2;
  }

  const workspaceRoot = path.resolve(parsed.workspace);

  try {
    if (parsed.uninstall || parsed.restore) {
      return runUninstall(parsed, workspaceRoot);
    }
    return runInstall(parsed, workspaceRoot);
  } catch (e) {
    if (e instanceof SettingsParseError) {
      console.error(
        `${RED}CHEM-INSTALL-HOOKS-002:${R} ${tr("diagnostic.settings_file_invalid_json", {
          path: e.path,
          reason: e.reason,
        })}`,
      );
      return 2;
    }
    console.error(`${RED}install-hooks failed:${R} ${(e as Error).message}`);
    return 2;
  }
}

function runInstall(args: ParsedArgs, workspaceRoot: string): number {
  const result = installClaudeCode({
    scope: args.scope,
    mode: args.mode,
    dryRun: args.dryRun,
    workspaceRoot,
  });

  console.log(`\n${BLD}chemag install-hooks${R}${args.dryRun ? ` ${DIM}(dry run)${R}` : ""}`);
  console.log(`  ${DIM}tool:${R}  claude`);
  console.log(`  ${DIM}scope:${R} ${args.scope}`);
  console.log(`  ${DIM}mode:${R}  ${args.mode}`);
  console.log(`  ${DIM}path:${R}  ${result.settingsPath}`);

  if (args.dryRun) {
    console.log(`\n${DIM}(planned changes — nothing written)${R}`);
    console.log(JSON.stringify(result.finalSettings, null, 2));
    return 0;
  }

  if (result.changed) {
    if (result.backupCreated) {
      console.log(`  ${GRN}+ backup${R} ${result.settingsPath}.bak`);
    }
    console.log(`  ${GRN}~${R} updated ${result.settingsPath}`);
  } else {
    console.log(`  ${DIM}=${R} no changes (already up to date)`);
  }

  void emitTelemetry("cli.command.install_hooks", {
    tool: "claude",
    scope: args.scope,
    mode: args.mode,
    action: "install",
  }).catch(() => {});

  return 0;
}

function runUninstall(args: ParsedArgs, workspaceRoot: string): number {
  // For non-restore uninstalls, emit a no-op note when nothing chemag-tagged
  // is present. CHEM-INSTALL-HOOKS-005 is informational (warning level).
  if (!args.restore) {
    const settingsPath = pathForScope(args.scope, workspaceRoot);
    if (!isAlreadyInstalled(settingsPath)) {
      console.log(
        `${YLW}CHEM-INSTALL-HOOKS-005:${R} ${tr("diagnostic.no_chemag_entries_to_uninstall", {
          path: settingsPath,
        })}`,
      );
      // Still call uninstall (no-op) for symmetry / dry-run reporting.
    }
  }

  const result = uninstallClaudeCode({
    scope: args.scope,
    restore: args.restore,
    dryRun: args.dryRun,
    workspaceRoot,
  });

  console.log(
    `\n${BLD}chemag install-hooks --uninstall${args.restore ? " --restore" : ""}${R}${
      args.dryRun ? ` ${DIM}(dry run)${R}` : ""
    }`,
  );
  console.log(`  ${DIM}tool:${R}  claude`);
  console.log(`  ${DIM}scope:${R} ${args.scope}`);
  console.log(`  ${DIM}path:${R}  ${result.settingsPath}`);

  if (args.dryRun) {
    console.log(`\n${DIM}(planned post-state)${R}`);
    console.log(JSON.stringify(result.finalSettings, null, 2));
    return 0;
  }

  if (result.changed) {
    console.log(`  ${GRN}~${R} ${args.restore ? "restored" : "scrubbed chemag entries"}`);
  } else {
    console.log(`  ${DIM}=${R} no changes`);
  }

  void emitTelemetry("cli.command.install_hooks", {
    tool: "claude",
    scope: args.scope,
    action: args.restore ? "restore" : "uninstall",
  }).catch(() => {});

  return 0;
}

function pathForScope(scope: InstallScope, workspaceRoot: string): string {
  return getClaudeSettingsPath(scope, workspaceRoot);
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): ParsedArgs {
  let tool = "";
  let scope: InstallScope = "project";
  let mode: InstallMode = "block";
  let uninstall = false;
  let restore = false;
  let dryRun = false;
  let workspace = ".";
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        help = true;
        break;
      case "--tool":
        tool = argv[++i] ?? "";
        break;
      case "--scope": {
        const v = argv[++i] ?? "";
        scope = parseScope(v);
        break;
      }
      case "--mode": {
        const v = argv[++i] ?? "";
        mode = parseMode(v);
        break;
      }
      case "--uninstall":
        uninstall = true;
        break;
      case "--restore":
        restore = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--workspace":
        workspace = argv[++i] ?? workspace;
        break;
      default:
        if (a.startsWith("--tool=")) {
          tool = a.slice("--tool=".length);
        } else if (a.startsWith("--scope=")) {
          scope = parseScope(a.slice("--scope=".length));
        } else if (a.startsWith("--mode=")) {
          mode = parseMode(a.slice("--mode=".length));
        } else if (a.startsWith("--workspace=")) {
          workspace = a.slice("--workspace=".length);
        } else if (a.startsWith("-")) {
          throw new Error(`Unknown flag: ${a}`);
        }
        break;
    }
  }

  if (!help && tool === "") {
    throw new Error("--tool is required (one of claude|cursor|codex|aider|cline|copilot|all)");
  }

  return { tool, scope, mode, uninstall, restore, dryRun, workspace, help };
}

function parseScope(v: string): InstallScope {
  if (v === "user" || v === "project") return v;
  const code = "CHEM-INSTALL-HOOKS-004";
  throw new Error(`${code}: ${tr("diagnostic.unknown_scope", { scope: v })}`);
}

function parseMode(v: string): InstallMode {
  if (v === "block" || v === "warn" || v === "context-only") return v;
  throw new Error(`Unknown --mode value "${v}". Use block|warn|context-only.`);
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`\n${BLD}${tr("cli.command.install_hooks")}${R}\n`);
  console.log(`${BLD}Options:${R}`);
  console.log(`  ${tr("cli.help.install_hooks.tool")}`);
  console.log(`  ${tr("cli.help.install_hooks.scope")}`);
  console.log(`  ${tr("cli.help.install_hooks.mode")}`);
  console.log("  --uninstall          Remove chemag hook entries (preserves non-chemag entries).");
  console.log("  --restore            With --uninstall: restore from <settings>.bak.");
  console.log("  --dry-run            Print planned changes without writing.");
  console.log("  --workspace <path>   Workspace root (defaults to cwd).");
}
