// ---------------------------------------------------------------------------
// Cursor hook installer.
//
// Cursor has no deterministic editor-side hook API today, so the "install"
// surface for Cursor is three things:
//   1. A husky-managed `.husky/pre-commit` line that runs `chemag check`
//      before every commit (the deterministic gate).
//   2. The `.cursor/rules/architecture.mdc` file regenerated via the
//      rules-emitter library (the AI-context layer).
//   3. A CONTRIBUTING.md fragment pointing devs at `chemag check-edit`.
//
// We do NOT delegate the .mdc step to `cmdEmitRules` (the CLI entry point
// for `chemag emit-rules`). That command handles argv parsing, telemetry,
// and exit codes — it's the wrong abstraction level for one installer
// calling another. Instead we follow the explicit 5-step library flow
// documented inline below, calling the same library primitives that
// `cmdEmitRules` calls. Test #8 enforces byte-equality between the two
// flows.
//
// `_backup.ts` (used by the Claude Code installer) is NOT consumed here.
// Cursor's deliverables are line-tagged in shell (`# _chemag` trailing
// comment) and marker-block-tagged in markdown (`<!-- chemag:contributing
// :start -->`). Neither is whole-file-replaced, so no backup is needed.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { discoverCompounds, loadCompound, loadWorkspace } from "@chemag/core/loader";
import { buildRulesContent, emitCursorMdc, mergeBetweenMarkers } from "@chemag/core/rules-emitters";
import type { LoadedCompound, Workspace } from "@chemag/core/types";
import { applyWorkspaceVocabulary } from "@chemag/core/vocabulary";
import {
  applyChemagBlock,
  readContributing,
  removeChemagBlock,
  writeContributing,
} from "./_contributing.js";
import {
  CHEMAG_PRECOMMIT_LINE,
  PrecommitUnparseableError,
  addChemagLine,
  detectHusky,
  readPrecommit,
  removeChemagLines,
  writePrecommit,
} from "./_husky.js";

export interface InstallCursorOpts {
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  /**
   * Mode flag — accepted for surface symmetry with the Claude Code
   * installer but ignored for Cursor (no deterministic editor hook to
   * downgrade). The installer surfaces an informational note when a non
   * default mode is passed.
   */
  mode: "block" | "warn" | "context-only";
  dryRun: boolean;
}

export interface UninstallCursorOpts {
  workspaceRoot: string;
  dryRun: boolean;
}

/**
 * Distinct from `InstallResult` in claude-code.ts because Cursor's
 * deliverables span three artifacts, not one settings file. Each artifact
 * carries its own per-write summary so the CLI can surface them.
 */
export interface CursorInstallResult {
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  precommit: ArtifactStatus;
  cursorMdc: ArtifactStatus;
  contributing: ArtifactStatus;
  /**
   * Informational notes that are not errors — e.g. "mode flag ignored for
   * cursor". Surfaced verbatim by the CLI.
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

/** Thrown when husky is not detected in the project root. */
export class HuskyNotDetectedError extends Error {
  readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    super(`husky is not set up in ${workspaceRoot}`);
    this.name = "HuskyNotDetectedError";
    this.workspaceRoot = workspaceRoot;
  }
}

// Re-export the husky errors so callers (the install-hooks command) can
// catch them without reaching into _husky.ts.
export { PrecommitUnparseableError } from "./_husky.js";

/**
 * Install chemag's Cursor integration. Idempotent — re-running over an
 * unchanged workspace produces byte-equal `.husky/pre-commit`,
 * `.cursor/rules/architecture.mdc`, and CONTRIBUTING.md files.
 *
 * Throws `HuskyNotDetectedError` (→ CHEM-INSTALL-HOOKS-007) when husky is
 * missing, or `PrecommitUnparseableError` (→ CHEM-INSTALL-HOOKS-008) when
 * an existing `.husky/pre-commit` cannot be safely modified.
 */
export function installCursor(opts: InstallCursorOpts): CursorInstallResult {
  const infoNotes = collectInfoNotes(opts);

  // ---- Step 1. Detect husky ----
  const husky = detectHusky(opts.workspaceRoot);
  if (!husky.detected) {
    throw new HuskyNotDetectedError(opts.workspaceRoot);
  }

  // ---- Step 2. Append the chemag pre-commit line ----
  const precommit = installPrecommit(husky.precommitPath, opts.dryRun);

  // ---- Step 3. Re-emit `.cursor/rules/architecture.mdc` via the 5-step library flow ----
  const cursorMdc = installCursorMdc(opts.workspaceRoot, opts.dryRun);

  // ---- Step 4. Append/refresh the CONTRIBUTING.md chemag block ----
  const contributing = installContributing(opts.workspaceRoot, opts.dryRun);

  return {
    workspaceRoot: opts.workspaceRoot,
    precommit,
    cursorMdc,
    contributing,
    infoNotes,
  };
}

/**
 * Uninstall chemag's Cursor integration. Removes:
 *   - chemag-tagged lines from `.husky/pre-commit`
 *   - the chemag block (and only that block) from CONTRIBUTING.md
 *
 * Does NOT delete `.cursor/rules/architecture.mdc` — see ADR-0004 §
 * "Cursor uninstall policy". The user can hand-remove the file or run
 * `chemag emit-rules` again to refresh it.
 */
export function uninstallCursor(opts: UninstallCursorOpts): CursorInstallResult {
  const husky = detectHusky(opts.workspaceRoot);

  const precommit = uninstallPrecommit(husky.precommitPath, opts.dryRun);
  const contributing = uninstallContributing(opts.workspaceRoot, opts.dryRun);

  // .cursor/rules/architecture.mdc is intentionally preserved on uninstall.
  const cursorMdcPath = path.join(opts.workspaceRoot, ".cursor/rules/architecture.mdc");
  const cursorMdc: ArtifactStatus = {
    path: cursorMdcPath,
    action: "skip",
  };

  return {
    workspaceRoot: opts.workspaceRoot,
    precommit,
    cursorMdc,
    contributing,
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
      // Re-throw with the actual path so the CLI can render it.
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

function installCursorMdc(workspaceRoot: string, dryRun: boolean): ArtifactStatus {
  // The 5-step library flow:
  //   1. loadWorkspace
  //   2. discoverCompounds
  //   3. buildRulesContent
  //   4. emitCursorMdc   (content-only)
  //   5. mergeBetweenMarkers + write

  // Step 1
  const wsPath = path.join(workspaceRoot, "workspace.yaml");
  // Workspace-load failures are surfaced as-is. The install-hooks command's
  // outer try/catch renders them. We don't remap to a new install-hooks code
  // because workspace-load failures are pre-condition errors covered by the
  // loader's contract, not installer-specific.
  const ws: Workspace = loadWorkspace(wsPath);
  applyWorkspaceVocabulary(ws);

  // Step 2 — match `cmdEmitRules` behavior on discovery failures (warn + empty list).
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
  const file = emitCursorMdc(content);

  // Step 5
  const targetPath = path.join(workspaceRoot, file.path);
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf-8") : null;

  const merged = mergeBetweenMarkers(existing, file.block, {
    isMdc: true,
    leading: file.leading,
    trailing: file.trailing,
    overwrite: false,
  });

  // Surface emitter warnings + merge warnings as plain stderr lines. The
  // CLI command renders them under CHEM-EMIT-RULES-002 when called via
  // `emit-rules`; here they are advisory and we let the caller decide.
  for (const w of file.warnings) {
    console.warn(`cursor: ${w}`);
  }
  for (const w of merged.warnings) {
    console.warn(`cursor: ${w}`);
  }

  const action: ArtifactStatus["action"] =
    existing === null ? "create" : existing === merged.body ? "no-op" : "update";

  if (!dryRun && action !== "no-op") {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, merged.body, "utf-8");
  }

  return { path: targetPath, action };
}

function installContributing(workspaceRoot: string, dryRun: boolean): ArtifactStatus {
  const filePath = path.join(workspaceRoot, "CONTRIBUTING.md");
  const existing = readContributing(filePath);
  const result = applyChemagBlock(existing);

  const action: ArtifactStatus["action"] = !result.changed
    ? "no-op"
    : existing === null
      ? "create"
      : "update";

  if (!dryRun && result.changed) writeContributing(filePath, result.body);

  return { path: filePath, action };
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

function uninstallContributing(workspaceRoot: string, dryRun: boolean): ArtifactStatus {
  const filePath = path.join(workspaceRoot, "CONTRIBUTING.md");
  if (!fs.existsSync(filePath)) {
    return { path: filePath, action: "skip" };
  }

  const existing = fs.readFileSync(filePath, "utf-8");
  const result = removeChemagBlock(existing);
  if (!result.changed) return { path: filePath, action: "skip" };

  if (!dryRun) {
    if (result.body === null) {
      fs.unlinkSync(filePath);
    } else {
      writeContributing(filePath, result.body);
    }
  }
  return { path: filePath, action: "update" };
}

function collectInfoNotes(opts: InstallCursorOpts): string[] {
  const notes: string[] = [];
  if (opts.mode !== "block") {
    notes.push(
      `--mode "${opts.mode}" is accepted for symmetry but ignored for cursor (no deterministic editor hook).`,
    );
  }
  return notes;
}

// Re-export the canonical line so tests can assert exact equality without
// reaching into _husky.ts.
export { CHEMAG_PRECOMMIT_LINE };
