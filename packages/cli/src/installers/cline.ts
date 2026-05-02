// ---------------------------------------------------------------------------
// Cline hook installer.
//
// Cline reads `.clinerules` at the workspace root by convention, so the
// install surface for `chemag install-hooks --tool cline` is two artifacts:
//   1. A husky-managed `.husky/pre-commit` line that runs `chemag check`
//      before every commit (the deterministic gate). Same one-liner as the
//      Cursor / Codex / Aider installers.
//   2. `.clinerules` regenerated via the rules-emitter library (the
//      AI-context layer Cline reads).
//
// Cline also supports MCP servers, but the actual `chemag mcp install
// --client cline` registration is owned by WP-017. Here we emit a follow-up
// tip pointing at that command via the SHARED parameterized vocabulary key
// `cli.install_hooks.tip.mcp_register` (introduced by WP-012, also used by
// the Codex installer). The tip's wording is rewritten by WP-017 once it
// lands; passing { clientName: "Cline", clientId: "cline" } here keeps the
// call site stable.
//
// We do NOT delegate the .clinerules step to `cmdEmitRules`. The 5-step
// library flow used here matches the Cursor and Codex installers; the
// byte-parity test enforces equality with `chemag emit-rules --tool cline`.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { discoverCompounds, loadCompound, loadWorkspace } from "@chemag/core/loader";
import {
  buildRulesContent,
  emitClineRules,
  MARKER_END,
  MARKER_START,
  mergeBetweenMarkers,
} from "@chemag/core/rules-emitters";
import type { LoadedCompound, Workspace } from "@chemag/core/types";
import { applyWorkspaceVocabulary } from "@chemag/core/vocabulary";
import {
  CHEMAG_PRECOMMIT_LINE,
  PrecommitUnparseableError,
  addChemagLine,
  detectHusky,
  readPrecommit,
  removeChemagLines,
  writePrecommit,
} from "./_husky.js";
import { HuskyNotDetectedError } from "./cursor.js";

export interface InstallClineOpts {
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  /**
   * Mode flag — accepted for surface symmetry with the Claude Code
   * installer but ignored for Cline (no deterministic editor hook to
   * downgrade). The installer surfaces an informational note when a
   * non-default mode is passed.
   */
  mode: "block" | "warn" | "context-only";
  dryRun: boolean;
}

export interface UninstallClineOpts {
  workspaceRoot: string;
  dryRun: boolean;
}

/**
 * Distinct from `InstallResult` in claude-code.ts because Cline's
 * deliverables span two artifacts, not one settings file.
 */
export interface ClineInstallResult {
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  precommit: ArtifactStatus;
  clinerules: ArtifactStatus;
  /**
   * Informational notes that are not errors — e.g. "mode flag ignored for
   * cline". Surfaced verbatim by the CLI.
   */
  infoNotes: string[];
}

export interface ArtifactStatus {
  path: string;
  /**
   * The action taken (or that would be taken under --dry-run).
   *   "create"   — file did not exist; we created it.
   *   "update"   — file existed; we modified it.
   *   "no-op"    — file existed; chemag block already up to date.
   *   "skip"     — file was not touched (e.g. uninstall when no chemag content).
   */
  action: "create" | "update" | "no-op" | "skip";
}

// Re-export so the install-hooks command can catch.
export { HuskyNotDetectedError } from "./cursor.js";
export { PrecommitUnparseableError } from "./_husky.js";

/**
 * Install chemag's Cline integration. Idempotent — re-running over an
 * unchanged workspace produces byte-equal `.husky/pre-commit` and
 * `.clinerules` files.
 *
 * Throws `HuskyNotDetectedError` (→ CHEM-INSTALL-HOOKS-007) when husky is
 * missing, or `PrecommitUnparseableError` (→ CHEM-INSTALL-HOOKS-008) when
 * an existing `.husky/pre-commit` cannot be safely modified.
 */
export function installCline(opts: InstallClineOpts): ClineInstallResult {
  const infoNotes = collectInfoNotes(opts);

  // ---- Step 1. Detect husky ----
  const husky = detectHusky(opts.workspaceRoot);
  if (!husky.detected) {
    throw new HuskyNotDetectedError(opts.workspaceRoot);
  }

  // ---- Step 2. Append the chemag pre-commit line ----
  const precommit = installPrecommit(husky.precommitPath, opts.dryRun);

  // ---- Step 3. Re-emit `.clinerules` via the 5-step library flow ----
  const clinerules = installClinerules(opts.workspaceRoot, opts.dryRun);

  return {
    workspaceRoot: opts.workspaceRoot,
    precommit,
    clinerules,
    infoNotes,
  };
}

/**
 * Uninstall chemag's Cline integration. Removes the chemag pre-commit
 * line. Does NOT delete `.clinerules` — same policy as Codex's AGENTS.md.
 */
export function uninstallCline(opts: UninstallClineOpts): ClineInstallResult {
  const husky = detectHusky(opts.workspaceRoot);

  const precommit = uninstallPrecommit(husky.precommitPath, opts.dryRun);

  // .clinerules is intentionally preserved on uninstall.
  const clinerulesPath = path.join(opts.workspaceRoot, ".clinerules");
  const clinerules: ArtifactStatus = {
    path: clinerulesPath,
    action: "skip",
  };

  return {
    workspaceRoot: opts.workspaceRoot,
    precommit,
    clinerules,
    infoNotes: [],
  };
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

function installPrecommit(precommitPath: string, dryRun: boolean): ArtifactStatus {
  let existing: string | null;
  try {
    existing = readPrecommit(precommitPath);
  } catch (e) {
    if (e instanceof PrecommitUnparseableError) {
      throw new PrecommitUnparseableError(precommitPath, e.reason);
    }
    throw e;
  }

  const result = addChemagLine(existing);

  if (!result.changed) {
    return { path: precommitPath, action: "no-op" };
  }

  if (!dryRun) writePrecommit(precommitPath, result.body);

  return {
    path: precommitPath,
    action: existing === null ? "create" : "update",
  };
}

function installClinerules(workspaceRoot: string, dryRun: boolean): ArtifactStatus {
  // The 5-step library flow:
  //   1. loadWorkspace
  //   2. discoverCompounds
  //   3. buildRulesContent
  //   4. emitClineRules   (content-only)
  //   5. mergeBetweenMarkers + write

  // Step 1
  const wsPath = path.join(workspaceRoot, "workspace.yaml");
  const ws: Workspace = loadWorkspace(wsPath);
  applyWorkspaceVocabulary(ws);

  // Step 2 — match `cmdEmitRules` behavior on discovery failures.
  let compounds: LoadedCompound[] = [];
  try {
    compounds = discoverCompounds(ws, workspaceRoot, { loadCompound });
  } catch (e) {
    console.warn(`warning: failed to discover compounds: ${(e as Error).message}`);
    compounds = [];
  }

  // Step 3
  const content = buildRulesContent(ws, compounds);

  // Step 4 — content-only.
  const file = emitClineRules(content);

  // Step 5
  const targetPath = path.join(workspaceRoot, file.path);
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf-8") : null;

  const hasMarkers = existing?.includes(MARKER_START) === true && existing.includes(MARKER_END);
  const merged =
    existing !== null && !hasMarkers
      ? appendBlock(existing, file.block)
      : mergeBetweenMarkers(existing, file.block, {
          isMdc: false,
          leading: file.leading,
          trailing: file.trailing,
          overwrite: false,
        });

  for (const w of file.warnings) {
    console.warn(`cline: ${w}`);
  }
  for (const w of merged.warnings) {
    console.warn(`cline: ${w}`);
  }

  const action: ArtifactStatus["action"] =
    existing === null ? "create" : existing === merged.body ? "no-op" : "update";

  if (!dryRun && action !== "no-op") {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, merged.body, "utf-8");
  }

  return { path: targetPath, action };
}

function appendBlock(existing: string, block: string): { body: string; warnings: string[] } {
  const trimmed = existing.replace(/\n+$/, "");
  const body = `${trimmed}\n\n${block}\n`;
  return { body, warnings: [] };
}

function uninstallPrecommit(precommitPath: string, dryRun: boolean): ArtifactStatus {
  if (!fs.existsSync(precommitPath)) {
    return { path: precommitPath, action: "skip" };
  }

  const existing = readPrecommit(precommitPath);
  if (existing === null) return { path: precommitPath, action: "skip" };

  let result: ReturnType<typeof removeChemagLines>;
  try {
    result = removeChemagLines(existing);
  } catch (e) {
    if (e instanceof PrecommitUnparseableError) {
      throw new PrecommitUnparseableError(precommitPath, e.reason);
    }
    throw e;
  }

  if (!result.changed) return { path: precommitPath, action: "skip" };

  if (!dryRun) {
    if (result.body === null) {
      fs.unlinkSync(precommitPath);
    } else {
      writePrecommit(precommitPath, result.body);
    }
  }
  return { path: precommitPath, action: "update" };
}

function collectInfoNotes(opts: InstallClineOpts): string[] {
  const notes: string[] = [];
  if (opts.mode !== "block") {
    notes.push(
      `--mode "${opts.mode}" is accepted for symmetry but ignored for cline (no deterministic editor hook).`,
    );
  }
  return notes;
}

// Re-export the canonical line so tests can assert exact equality without
// reaching into _husky.ts.
export { CHEMAG_PRECOMMIT_LINE };
