// ---------------------------------------------------------------------------
// Codex (OpenAI) hook installer.
//
// Codex standardizes on AGENTS.md as its rule file, so the "install" surface
// for `chemag install-hooks --tool codex` is two artifacts:
//   1. A husky-managed `.husky/pre-commit` line that runs `chemag check`
//      before every commit (the deterministic gate). Same one-liner as the
//      Cursor installer.
//   2. AGENTS.md at the workspace root, regenerated via the rules-emitter
//      library (the AI-context layer).
//
// We do NOT delegate the AGENTS.md step to `cmdEmitRules` (the CLI entry
// point for `chemag emit-rules`). That command handles argv parsing,
// telemetry, and exit codes — it's the wrong abstraction level for one
// installer calling another. Instead we follow the explicit 5-step library
// flow documented inline below, calling the same library primitives that
// `cmdEmitRules` calls. The byte-parity test enforces equality between the
// two flows.
//
// `_backup.ts` (used by the Claude Code installer) is NOT consumed here.
// Codex's deliverables are line-tagged in shell (`# _chemag` trailing
// comment) and marker-block-tagged in markdown (`<!-- chemag:rules:start -->`).
// Neither is whole-file-replaced, so no backup is needed.
//
// The husky-missing diagnostic is tool-agnostic (CHEM-INSTALL-HOOKS-007 with
// trKey `diagnostic.husky_not_detected`) so the Cursor and Codex installers
// share the same code path; future installers (Aider/Cline/Copilot in
// WP-013) reuse it without churn.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { discoverCompounds, loadCompound, loadWorkspace } from "@chemag/core/loader";
import {
  buildRulesContent,
  emitAgentsMd,
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

export interface InstallCodexOpts {
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  /**
   * Mode flag — accepted for surface symmetry with the Claude Code
   * installer but ignored for Codex (no deterministic editor hook to
   * downgrade). The installer surfaces an informational note when a
   * non-default mode is passed.
   */
  mode: "block" | "warn" | "context-only";
  dryRun: boolean;
}

export interface UninstallCodexOpts {
  workspaceRoot: string;
  dryRun: boolean;
}

/**
 * Distinct from `InstallResult` in claude-code.ts because Codex's
 * deliverables span two artifacts, not one settings file. Each artifact
 * carries its own per-write summary so the CLI can surface them.
 */
export interface CodexInstallResult {
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  precommit: ArtifactStatus;
  agentsMd: ArtifactStatus;
  /**
   * Informational notes that are not errors — e.g. "mode flag ignored for
   * codex". Surfaced verbatim by the CLI.
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

// Re-export the husky errors so callers (the install-hooks command) can catch
// them without reaching into _husky.ts. We import HuskyNotDetectedError from
// cursor.ts (where it was first defined in WP-011) to keep a single source of
// truth — both installers throw the same instance type.
export { HuskyNotDetectedError } from "./cursor.js";
export { PrecommitUnparseableError } from "./_husky.js";

/**
 * Install chemag's Codex integration. Idempotent — re-running over an
 * unchanged workspace produces byte-equal `.husky/pre-commit` and
 * `AGENTS.md` files.
 *
 * Throws `HuskyNotDetectedError` (→ CHEM-INSTALL-HOOKS-007 with the
 * tool-agnostic trKey `diagnostic.husky_not_detected`) when husky is
 * missing, or `PrecommitUnparseableError` (→ CHEM-INSTALL-HOOKS-008) when
 * an existing `.husky/pre-commit` cannot be safely modified.
 */
export function installCodex(opts: InstallCodexOpts): CodexInstallResult {
  const infoNotes = collectInfoNotes(opts);

  // ---- Step 1. Detect husky ----
  const husky = detectHusky(opts.workspaceRoot);
  if (!husky.detected) {
    throw new HuskyNotDetectedError(opts.workspaceRoot);
  }

  // ---- Step 2. Append the chemag pre-commit line ----
  const precommit = installPrecommit(husky.precommitPath, opts.dryRun);

  // ---- Step 3. Re-emit AGENTS.md via the 5-step library flow ----
  const agentsMd = installAgentsMd(opts.workspaceRoot, opts.dryRun);

  return {
    workspaceRoot: opts.workspaceRoot,
    precommit,
    agentsMd,
    infoNotes,
  };
}

/**
 * Uninstall chemag's Codex integration. Removes:
 *   - chemag-tagged lines from `.husky/pre-commit`
 *
 * Does NOT delete `AGENTS.md` — same policy as `.cursor/rules/architecture.mdc`
 * (see ADR-0004 § "Cursor uninstall policy"). The user can hand-remove the
 * file or run `chemag emit-rules --tool codex` again to refresh it.
 */
export function uninstallCodex(opts: UninstallCodexOpts): CodexInstallResult {
  const husky = detectHusky(opts.workspaceRoot);

  const precommit = uninstallPrecommit(husky.precommitPath, opts.dryRun);

  // AGENTS.md is intentionally preserved on uninstall.
  const agentsMdPath = path.join(opts.workspaceRoot, "AGENTS.md");
  const agentsMd: ArtifactStatus = {
    path: agentsMdPath,
    action: "skip",
  };

  return {
    workspaceRoot: opts.workspaceRoot,
    precommit,
    agentsMd,
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

function installAgentsMd(workspaceRoot: string, dryRun: boolean): ArtifactStatus {
  // The 5-step library flow:
  //   1. loadWorkspace
  //   2. discoverCompounds
  //   3. buildRulesContent
  //   4. emitAgentsMd   (content-only)
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
  const file = emitAgentsMd(content);

  // Step 5
  const targetPath = path.join(workspaceRoot, file.path);
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf-8") : null;

  // If AGENTS.md exists but has no chemag markers, the installer cannot use
  // `mergeBetweenMarkers` directly with `overwrite: false` — the merge call
  // would throw `MarkersMissingError`. The contract for the installer
  // (criterion 5) is "preserve manual content outside the chemag markers";
  // we satisfy that by appending the chemag block to the existing content
  // verbatim. Subsequent runs find the markers and round-trip via the normal
  // splice path.
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

  // Surface emitter warnings + merge warnings as plain stderr lines.
  for (const w of file.warnings) {
    console.warn(`codex: ${w}`);
  }
  for (const w of merged.warnings) {
    console.warn(`codex: ${w}`);
  }

  const action: ArtifactStatus["action"] =
    existing === null ? "create" : existing === merged.body ? "no-op" : "update";

  if (!dryRun && action !== "no-op") {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, merged.body, "utf-8");
  }

  return { path: targetPath, action };
}

/**
 * Append the chemag block to `existing` content that does not yet contain
 * chemag markers. Preserves trailing-newline semantics so that subsequent
 * splice-merges (once the markers are in place) round-trip cleanly.
 *
 * Returned shape mirrors `MergeResult` so callers can treat the two paths
 * uniformly.
 */
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

function collectInfoNotes(opts: InstallCodexOpts): string[] {
  const notes: string[] = [];
  if (opts.mode !== "block") {
    notes.push(
      `--mode "${opts.mode}" is accepted for symmetry but ignored for codex (no deterministic editor hook).`,
    );
  }
  return notes;
}

// Re-export the canonical line so tests can assert exact equality without
// reaching into _husky.ts.
export { CHEMAG_PRECOMMIT_LINE };
