// ---------------------------------------------------------------------------
// `chemag install-hooks` — install / uninstall AI-editor hook integrations.
//
// Implemented tools:
//   * claude (WP-010)
//   * cursor (WP-011) — husky pre-commit + .cursor/rules/architecture.mdc
//                        + CONTRIBUTING.md fragment
//   * codex  (WP-012) — husky pre-commit + AGENTS.md
//
// Pending tools (still error CHEM-INSTALL-HOOKS-001):
//   * aider / cline / copilot / all
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
import {
  HuskyNotDetectedError,
  PrecommitUnparseableError,
  installCursor,
  uninstallCursor,
  type CursorInstallResult,
} from "../installers/cursor.js";
import { installCodex, uninstallCodex, type CodexInstallResult } from "../installers/codex.js";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const YLW = "\x1b[33m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

// All recognized tool names. `claude`, `cursor`, and `codex` are implemented.
const KNOWN_TOOLS = new Set(["claude", "cursor", "codex", "aider", "cline", "copilot", "all"]);
const IMPLEMENTED_TOOLS = new Set(["claude", "cursor", "codex"]);

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

  if (!IMPLEMENTED_TOOLS.has(parsed.tool)) {
    const code = "CHEM-INSTALL-HOOKS-001";
    console.error(
      `${RED}${code}:${R} ${tr("diagnostic.tool_not_yet_implemented", { tool: parsed.tool })}`,
    );
    return 2;
  }

  const workspaceRoot = path.resolve(parsed.workspace);

  if (parsed.tool === "cursor") {
    return runCursor(parsed, workspaceRoot);
  }

  if (parsed.tool === "codex") {
    return runCodex(parsed, workspaceRoot);
  }

  // claude path
  try {
    if (parsed.uninstall || parsed.restore) {
      return runClaudeUninstall(parsed, workspaceRoot);
    }
    return runClaudeInstall(parsed, workspaceRoot);
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

// ---------------------------------------------------------------------------
// Claude path
// ---------------------------------------------------------------------------

function runClaudeInstall(args: ParsedArgs, workspaceRoot: string): number {
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

function runClaudeUninstall(args: ParsedArgs, workspaceRoot: string): number {
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

// ---------------------------------------------------------------------------
// Cursor path
// ---------------------------------------------------------------------------

function runCursor(args: ParsedArgs, workspaceRoot: string): number {
  if (args.restore) {
    // --restore is a Claude-Code-specific concept (.bak file). Cursor's
    // deliverables are line/marker tagged, not whole-file replaced.
    console.error(
      `${RED}install-hooks failed:${R} --restore is not supported for --tool cursor (Cursor's installer does not write .bak files).`,
    );
    return 2;
  }

  // --scope is irrelevant for husky (always project-scoped). Surface an
  // informational note without failing.
  if (args.scope !== "project") {
    console.warn(
      `${YLW}note:${R} --scope ${args.scope} ignored for cursor (husky is always project-scoped).`,
    );
  }

  try {
    const result = args.uninstall
      ? uninstallCursor({ workspaceRoot, dryRun: args.dryRun })
      : installCursor({ workspaceRoot, mode: args.mode, dryRun: args.dryRun });
    renderCursorSummary(result, args);

    void emitTelemetry("cli.command.install_hooks", {
      tool: "cursor",
      scope: args.scope,
      mode: args.mode,
      action: args.uninstall ? "uninstall" : "install",
    }).catch(() => {});

    return 0;
  } catch (e) {
    if (e instanceof HuskyNotDetectedError) {
      console.error(
        `${RED}CHEM-INSTALL-HOOKS-007:${R} ${tr("diagnostic.husky_not_detected", {
          workspace: e.workspaceRoot,
        })}`,
      );
      return 2;
    }
    if (e instanceof PrecommitUnparseableError) {
      console.error(
        `${RED}CHEM-INSTALL-HOOKS-008:${R} ${tr("diagnostic.cursor_precommit_unparseable", {
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

function renderCursorSummary(result: CursorInstallResult, args: ParsedArgs): void {
  const headline = args.uninstall ? "chemag install-hooks --uninstall" : "chemag install-hooks";
  console.log(`\n${BLD}${headline}${R}${args.dryRun ? ` ${DIM}(dry run)${R}` : ""}`);
  console.log(`  ${DIM}tool:${R}  cursor`);
  console.log(`  ${DIM}root:${R}  ${result.workspaceRoot}`);

  for (const note of result.infoNotes) {
    console.log(`  ${DIM}note:${R} ${note}`);
  }

  for (const artifact of [result.precommit, result.cursorMdc, result.contributing]) {
    const verb = mapAction(artifact.action);
    console.log(`  ${verb}  ${artifact.path}`);
  }
}

function mapAction(action: "create" | "update" | "no-op" | "skip"): string {
  switch (action) {
    case "create":
      return `${GRN}+${R}`;
    case "update":
      return `${GRN}~${R}`;
    case "no-op":
      return `${DIM}=${R}`;
    case "skip":
      return `${DIM}.${R}`;
  }
}

// ---------------------------------------------------------------------------
// Codex path
// ---------------------------------------------------------------------------

function runCodex(args: ParsedArgs, workspaceRoot: string): number {
  if (args.restore) {
    // --restore is a Claude-Code-specific concept (.bak file). Codex's
    // deliverables are line/marker tagged, not whole-file replaced.
    console.error(
      `${RED}install-hooks failed:${R} --restore is not supported for --tool codex (Codex's installer does not write .bak files).`,
    );
    return 2;
  }

  // --scope is irrelevant for husky (always project-scoped). Surface an
  // informational note without failing.
  if (args.scope !== "project") {
    console.warn(
      `${YLW}note:${R} --scope ${args.scope} ignored for codex (husky is always project-scoped).`,
    );
  }

  try {
    const result = args.uninstall
      ? uninstallCodex({ workspaceRoot, dryRun: args.dryRun })
      : installCodex({ workspaceRoot, mode: args.mode, dryRun: args.dryRun });
    renderCodexSummary(result, args);

    void emitTelemetry("cli.command.install_hooks", {
      tool: "codex",
      scope: args.scope,
      mode: args.mode,
      action: args.uninstall ? "uninstall" : "install",
    }).catch(() => {});

    return 0;
  } catch (e) {
    if (e instanceof HuskyNotDetectedError) {
      console.error(
        `${RED}CHEM-INSTALL-HOOKS-007:${R} ${tr("diagnostic.husky_not_detected", {
          workspace: e.workspaceRoot,
        })}`,
      );
      return 2;
    }
    if (e instanceof PrecommitUnparseableError) {
      console.error(
        `${RED}CHEM-INSTALL-HOOKS-008:${R} ${tr("diagnostic.cursor_precommit_unparseable", {
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

function renderCodexSummary(result: CodexInstallResult, args: ParsedArgs): void {
  const headline = args.uninstall ? "chemag install-hooks --uninstall" : "chemag install-hooks";
  console.log(`\n${BLD}${headline}${R}${args.dryRun ? ` ${DIM}(dry run)${R}` : ""}`);
  console.log(`  ${DIM}tool:${R}  codex`);
  console.log(`  ${DIM}root:${R}  ${result.workspaceRoot}`);

  for (const note of result.infoNotes) {
    console.log(`  ${DIM}note:${R} ${note}`);
  }

  for (const artifact of [result.precommit, result.agentsMd]) {
    const verb = mapAction(artifact.action);
    console.log(`  ${verb}  ${artifact.path}`);
  }

  // After-install MCP tip (cross-references WP-017). Always surface on install
  // (not on uninstall) so the user knows the next step.
  if (!args.uninstall) {
    const tip = tr("cli.install_hooks.tip.mcp_register", {
      clientName: "Codex",
      clientId: "codex",
    });
    console.log(`  ${DIM}tip:${R}  ${tip}`);
  }
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
  console.log(
    "  --restore            With --uninstall: restore from <settings>.bak (claude only).",
  );
  console.log("  --dry-run            Print planned changes without writing.");
  console.log("  --workspace <path>   Workspace root (defaults to cwd).");
}
