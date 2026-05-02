// ---------------------------------------------------------------------------
// `chemag install-hooks` — install / uninstall AI-editor hook integrations.
//
// Implemented tools:
//   * claude  (WP-010)
//   * cursor  (WP-011) — husky pre-commit + .cursor/rules/architecture.mdc
//                         + CONTRIBUTING.md fragment
//   * codex   (WP-012) — husky pre-commit + AGENTS.md
//   * aider   (WP-013) — husky pre-commit + .aider/CONVENTIONS.md
//                         + chemag block in .aider.conf.yml
//   * cline   (WP-013) — husky pre-commit + .clinerules + MCP follow-up tip
//   * copilot (WP-013) — husky pre-commit + .github/copilot-instructions.md
//                         + .github/workflows/chemag-pr.yml
//   * all     (WP-018) — fan out across every tool above with per-tool error
//                         aggregation; non-zero exit if any tool failed.
//
// Surface:
//   chemag install-hooks --tool <claude|cursor|codex|aider|cline|copilot|all>
//                        [--scope user|project]                default: project
//                        [--mode block|warn|context-only]       default: block
//                        [--uninstall]
//                        [--restore]
//                        [--overwrite]                         (copilot only)
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
import {
  AiderConfInvalidYamlError,
  installAider,
  uninstallAider,
  type AiderInstallResult,
} from "../installers/aider.js";
import { installCline, uninstallCline, type ClineInstallResult } from "../installers/cline.js";
import {
  CopilotWorkflowExistsNoOverwriteError,
  installCopilot,
  uninstallCopilot,
  type CopilotInstallResult,
} from "../installers/copilot.js";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const YLW = "\x1b[33m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

// All recognized tool names. Single-tool slots route to a dedicated handler;
// `all` (WP-018) fans out across every member of FAN_OUT_TOOLS with per-tool
// error aggregation.
const KNOWN_TOOLS = new Set(["claude", "cursor", "codex", "aider", "cline", "copilot", "all"]);
const IMPLEMENTED_TOOLS = new Set([
  "claude",
  "cursor",
  "codex",
  "aider",
  "cline",
  "copilot",
  "all",
]);

/**
 * Tools the `--tool all` fan-out iterates over, in deterministic display
 * order. Order matters because the summary table is rendered in this
 * sequence and the WP-018 reference-monorepo CI snapshot pins it.
 */
const FAN_OUT_TOOLS = ["claude", "cursor", "codex", "aider", "cline", "copilot"] as const;
type FanOutTool = (typeof FAN_OUT_TOOLS)[number];

interface ParsedArgs {
  tool: string;
  scope: InstallScope;
  mode: InstallMode;
  uninstall: boolean;
  restore: boolean;
  overwrite: boolean;
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

  if (parsed.tool === "all") {
    return runAll(parsed, workspaceRoot);
  }

  if (parsed.tool === "cursor") {
    return runCursor(parsed, workspaceRoot);
  }

  if (parsed.tool === "codex") {
    return runCodex(parsed, workspaceRoot);
  }

  if (parsed.tool === "aider") {
    return runAider(parsed, workspaceRoot);
  }

  if (parsed.tool === "cline") {
    return runCline(parsed, workspaceRoot);
  }

  if (parsed.tool === "copilot") {
    return runCopilot(parsed, workspaceRoot);
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

// ---------------------------------------------------------------------------
// Aider path
// ---------------------------------------------------------------------------

function runAider(args: ParsedArgs, workspaceRoot: string): number {
  if (args.restore) {
    console.error(
      `${RED}install-hooks failed:${R} --restore is not supported for --tool aider (Aider's installer does not write .bak files).`,
    );
    return 2;
  }

  if (args.scope !== "project") {
    console.warn(
      `${YLW}note:${R} --scope ${args.scope} ignored for aider (husky is always project-scoped).`,
    );
  }

  try {
    const result = args.uninstall
      ? uninstallAider({ workspaceRoot, dryRun: args.dryRun })
      : installAider({ workspaceRoot, mode: args.mode, dryRun: args.dryRun });
    renderAiderSummary(result, args);

    void emitTelemetry("cli.command.install_hooks", {
      tool: "aider",
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
    if (e instanceof AiderConfInvalidYamlError) {
      console.error(
        `${RED}CHEM-INSTALL-HOOKS-009:${R} ${tr("diagnostic.aider_conf_invalid_yaml", {
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

function renderAiderSummary(result: AiderInstallResult, args: ParsedArgs): void {
  const headline = args.uninstall ? "chemag install-hooks --uninstall" : "chemag install-hooks";
  console.log(`\n${BLD}${headline}${R}${args.dryRun ? ` ${DIM}(dry run)${R}` : ""}`);
  console.log(`  ${DIM}tool:${R}  aider`);
  console.log(`  ${DIM}root:${R}  ${result.workspaceRoot}`);

  for (const note of result.infoNotes) {
    console.log(`  ${DIM}note:${R} ${note}`);
  }

  for (const artifact of [result.precommit, result.conventions, result.aiderConf]) {
    const verb = mapAction(artifact.action);
    console.log(`  ${verb}  ${artifact.path}`);
  }
}

// ---------------------------------------------------------------------------
// Cline path
// ---------------------------------------------------------------------------

function runCline(args: ParsedArgs, workspaceRoot: string): number {
  if (args.restore) {
    console.error(
      `${RED}install-hooks failed:${R} --restore is not supported for --tool cline (Cline's installer does not write .bak files).`,
    );
    return 2;
  }

  if (args.scope !== "project") {
    console.warn(
      `${YLW}note:${R} --scope ${args.scope} ignored for cline (husky is always project-scoped).`,
    );
  }

  try {
    const result = args.uninstall
      ? uninstallCline({ workspaceRoot, dryRun: args.dryRun })
      : installCline({ workspaceRoot, mode: args.mode, dryRun: args.dryRun });
    renderClineSummary(result, args);

    void emitTelemetry("cli.command.install_hooks", {
      tool: "cline",
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

function renderClineSummary(result: ClineInstallResult, args: ParsedArgs): void {
  const headline = args.uninstall ? "chemag install-hooks --uninstall" : "chemag install-hooks";
  console.log(`\n${BLD}${headline}${R}${args.dryRun ? ` ${DIM}(dry run)${R}` : ""}`);
  console.log(`  ${DIM}tool:${R}  cline`);
  console.log(`  ${DIM}root:${R}  ${result.workspaceRoot}`);

  for (const note of result.infoNotes) {
    console.log(`  ${DIM}note:${R} ${note}`);
  }

  for (const artifact of [result.precommit, result.clinerules]) {
    const verb = mapAction(artifact.action);
    console.log(`  ${verb}  ${artifact.path}`);
  }

  // After-install MCP tip (cross-references WP-017). Always surface on install
  // (not on uninstall) so the user knows the next step.
  if (!args.uninstall) {
    const tip = tr("cli.install_hooks.tip.mcp_register", {
      clientName: "Cline",
      clientId: "cline",
    });
    console.log(`  ${DIM}tip:${R}  ${tip}`);
  }
}

// ---------------------------------------------------------------------------
// Copilot path
// ---------------------------------------------------------------------------

function runCopilot(args: ParsedArgs, workspaceRoot: string): number {
  if (args.restore) {
    console.error(
      `${RED}install-hooks failed:${R} --restore is not supported for --tool copilot (Copilot's installer does not write .bak files).`,
    );
    return 2;
  }

  if (args.scope !== "project") {
    console.warn(
      `${YLW}note:${R} --scope ${args.scope} ignored for copilot (husky is always project-scoped).`,
    );
  }

  try {
    const result = args.uninstall
      ? uninstallCopilot({ workspaceRoot, dryRun: args.dryRun })
      : installCopilot({
          workspaceRoot,
          mode: args.mode,
          dryRun: args.dryRun,
          overwrite: args.overwrite,
        });
    renderCopilotSummary(result, args);

    void emitTelemetry("cli.command.install_hooks", {
      tool: "copilot",
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
    if (e instanceof CopilotWorkflowExistsNoOverwriteError) {
      console.error(
        `${RED}CHEM-INSTALL-HOOKS-010:${R} ${tr("diagnostic.copilot_workflow_exists_no_overwrite", {
          path: e.path,
        })}`,
      );
      return 2;
    }
    console.error(`${RED}install-hooks failed:${R} ${(e as Error).message}`);
    return 2;
  }
}

function renderCopilotSummary(result: CopilotInstallResult, args: ParsedArgs): void {
  const headline = args.uninstall ? "chemag install-hooks --uninstall" : "chemag install-hooks";
  console.log(`\n${BLD}${headline}${R}${args.dryRun ? ` ${DIM}(dry run)${R}` : ""}`);
  console.log(`  ${DIM}tool:${R}  copilot`);
  console.log(`  ${DIM}root:${R}  ${result.workspaceRoot}`);

  for (const note of result.infoNotes) {
    console.log(`  ${DIM}note:${R} ${note}`);
  }

  for (const artifact of [result.precommit, result.copilotInstructions, result.prWorkflow]) {
    const verb = mapAction(artifact.action);
    console.log(`  ${verb}  ${artifact.path}`);
  }
}

function pathForScope(scope: InstallScope, workspaceRoot: string): string {
  return getClaudeSettingsPath(scope, workspaceRoot);
}

// ---------------------------------------------------------------------------
// Fan-out path (`--tool all`) — WP-018
// ---------------------------------------------------------------------------

/** Per-tool result row rendered in the fan-out summary table. */
interface FanOutRow {
  tool: FanOutTool;
  /**
   * `ok`     — installer ran and made changes (create/update/install).
   * `no-op`  — installer ran and reported nothing to do (idempotent rerun).
   * `error`  — installer threw or returned a known error code.
   */
  status: "ok" | "no-op" | "error";
  /** Diagnostic code (CHEM-INSTALL-HOOKS-NNN) when status === "error". */
  code?: string;
  /** Short human-readable message for the table cell. */
  message?: string;
}

/**
 * Action statuses we treat as no-ops for table rendering. Any other action
 * (`create`, `update`) means real work happened on this tool's path.
 */
function isAllNoOp(actions: Array<"create" | "update" | "no-op" | "skip">): boolean {
  return actions.every((a) => a === "no-op" || a === "skip");
}

/** Run each tool in `FAN_OUT_TOOLS`, aggregate status, render summary. */
function runAll(args: ParsedArgs, workspaceRoot: string): number {
  // --tool all does not accept --restore / --overwrite / --uninstall in WP-018.
  // (These are tool-specific and fan-out is install-only by design.)
  if (args.uninstall || args.restore) {
    console.error(
      `${RED}install-hooks failed:${R} --tool all does not support --uninstall / --restore (run per-tool to uninstall).`,
    );
    return 2;
  }

  const headline = "chemag install-hooks --tool all";
  console.log(`\n${BLD}${headline}${R}${args.dryRun ? ` ${DIM}(dry run)${R}` : ""}`);
  console.log(`  ${DIM}root:${R}  ${workspaceRoot}`);
  console.log(`  ${DIM}mode:${R}  ${args.mode}`);

  const rows: FanOutRow[] = [];
  for (const tool of FAN_OUT_TOOLS) {
    const row = runOneForFanOut(tool, args, workspaceRoot);
    rows.push(row);

    // Per-tool telemetry — mirrors the per-tool runners' shape so downstream
    // analytics see one event per tool regardless of fan-out vs. direct call.
    void emitTelemetry("cli.command.install_hooks", {
      tool,
      scope: args.scope,
      mode: args.mode,
      action: "install",
      result: row.status,
    }).catch(() => {});
  }

  renderFanOutSummary(rows);

  const errored = rows.filter((r) => r.status === "error").length;
  const oks = rows.filter((r) => r.status === "ok" || r.status === "no-op").length;
  const aggregateResult: "ok" | "partial" | "error" =
    errored === 0 ? "ok" : oks === 0 ? "error" : "partial";

  // Aggregate telemetry event — emitted exactly once per --tool all invocation.
  void emitTelemetry("cli.command.install_hooks", {
    tool: "all",
    scope: args.scope,
    mode: args.mode,
    action: "install",
    result: aggregateResult,
    tools_count: FAN_OUT_TOOLS.length,
    errored_count: errored,
  }).catch(() => {});

  return errored === 0 ? 0 : 2;
}

/**
 * Execute a single tool's installer for the fan-out path. Returns a structured
 * `FanOutRow` instead of writing per-tool console output. Errors are caught and
 * converted into `error` rows so the loop can continue with remaining tools.
 */
function runOneForFanOut(tool: FanOutTool, args: ParsedArgs, workspaceRoot: string): FanOutRow {
  try {
    switch (tool) {
      case "claude":
        return runClaudeForFanOut(args, workspaceRoot);
      case "cursor":
        return runCursorForFanOut(args, workspaceRoot);
      case "codex":
        return runCodexForFanOut(args, workspaceRoot);
      case "aider":
        return runAiderForFanOut(args, workspaceRoot);
      case "cline":
        return runClineForFanOut(args, workspaceRoot);
      case "copilot":
        return runCopilotForFanOut(args, workspaceRoot);
    }
  } catch (e) {
    return classifyFanOutError(tool, e);
  }
}

function classifyFanOutError(tool: FanOutTool, e: unknown): FanOutRow {
  if (e instanceof SettingsParseError) {
    return {
      tool,
      status: "error",
      code: "CHEM-INSTALL-HOOKS-002",
      message: e.reason,
    };
  }
  if (e instanceof HuskyNotDetectedError) {
    return {
      tool,
      status: "error",
      code: "CHEM-INSTALL-HOOKS-007",
      message: "husky not detected",
    };
  }
  if (e instanceof PrecommitUnparseableError) {
    return {
      tool,
      status: "error",
      code: "CHEM-INSTALL-HOOKS-008",
      message: e.reason,
    };
  }
  if (e instanceof AiderConfInvalidYamlError) {
    return {
      tool,
      status: "error",
      code: "CHEM-INSTALL-HOOKS-009",
      message: e.reason,
    };
  }
  if (e instanceof CopilotWorkflowExistsNoOverwriteError) {
    return {
      tool,
      status: "error",
      code: "CHEM-INSTALL-HOOKS-010",
      message: "workflow exists; pass --overwrite",
    };
  }
  return {
    tool,
    status: "error",
    message: e instanceof Error ? e.message : String(e),
  };
}

function runClaudeForFanOut(args: ParsedArgs, workspaceRoot: string): FanOutRow {
  const result = installClaudeCode({
    scope: args.scope,
    mode: args.mode,
    dryRun: args.dryRun,
    workspaceRoot,
  });
  // Claude installer returns `changed: boolean`; map to ok / no-op.
  return { tool: "claude", status: result.changed ? "ok" : "no-op" };
}

function runCursorForFanOut(args: ParsedArgs, workspaceRoot: string): FanOutRow {
  const result = installCursor({
    workspaceRoot,
    mode: args.mode,
    dryRun: args.dryRun,
  });
  const actions = [result.precommit.action, result.cursorMdc.action, result.contributing.action];
  return { tool: "cursor", status: isAllNoOp(actions) ? "no-op" : "ok" };
}

function runCodexForFanOut(args: ParsedArgs, workspaceRoot: string): FanOutRow {
  const result = installCodex({
    workspaceRoot,
    mode: args.mode,
    dryRun: args.dryRun,
  });
  const actions = [result.precommit.action, result.agentsMd.action];
  return { tool: "codex", status: isAllNoOp(actions) ? "no-op" : "ok" };
}

function runAiderForFanOut(args: ParsedArgs, workspaceRoot: string): FanOutRow {
  const result = installAider({
    workspaceRoot,
    mode: args.mode,
    dryRun: args.dryRun,
  });
  const actions = [result.precommit.action, result.conventions.action, result.aiderConf.action];
  return { tool: "aider", status: isAllNoOp(actions) ? "no-op" : "ok" };
}

function runClineForFanOut(args: ParsedArgs, workspaceRoot: string): FanOutRow {
  const result = installCline({
    workspaceRoot,
    mode: args.mode,
    dryRun: args.dryRun,
  });
  const actions = [result.precommit.action, result.clinerules.action];
  return { tool: "cline", status: isAllNoOp(actions) ? "no-op" : "ok" };
}

function runCopilotForFanOut(args: ParsedArgs, workspaceRoot: string): FanOutRow {
  const result = installCopilot({
    workspaceRoot,
    mode: args.mode,
    dryRun: args.dryRun,
    overwrite: args.overwrite,
  });
  const actions = [
    result.precommit.action,
    result.copilotInstructions.action,
    result.prWorkflow.action,
  ];
  return { tool: "copilot", status: isAllNoOp(actions) ? "no-op" : "ok" };
}

function renderFanOutSummary(rows: FanOutRow[]): void {
  // Compute the column widths so the box stays tidy across tool name lengths.
  const toolWidth = Math.max(4, ...rows.map((r) => r.tool.length));
  const statusWidth = Math.max(6, ...rows.map((r) => r.status.length));
  const codeWidth = Math.max(4, ...rows.map((r) => (r.code ?? "").length));

  console.log("");
  const header = `  ${"tool".padEnd(toolWidth)}  ${"status".padEnd(statusWidth)}  ${"code".padEnd(
    codeWidth,
  )}  message`;
  console.log(`${BLD}${header}${R}`);
  console.log(
    `  ${"-".repeat(toolWidth)}  ${"-".repeat(statusWidth)}  ${"-".repeat(codeWidth)}  -------`,
  );

  for (const r of rows) {
    const colored =
      r.status === "ok"
        ? `${GRN}${r.status.padEnd(statusWidth)}${R}`
        : r.status === "no-op"
          ? `${DIM}${r.status.padEnd(statusWidth)}${R}`
          : `${RED}${r.status.padEnd(statusWidth)}${R}`;
    console.log(
      `  ${r.tool.padEnd(toolWidth)}  ${colored}  ${(r.code ?? "").padEnd(codeWidth)}  ${
        r.message ?? ""
      }`,
    );
  }
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
  let overwrite = false;
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
      case "--overwrite":
        overwrite = true;
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

  return { tool, scope, mode, uninstall, restore, overwrite, dryRun, workspace, help };
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
  console.log(
    "  --overwrite          Replace .github/workflows/chemag-pr.yml even without the chemag header (copilot only).",
  );
  console.log("  --dry-run            Print planned changes without writing.");
  console.log("  --workspace <path>   Workspace root (defaults to cwd).");
}
