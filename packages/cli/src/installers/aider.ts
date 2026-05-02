// ---------------------------------------------------------------------------
// Aider hook installer.
//
// Aider's install surface for `chemag install-hooks --tool aider` is three
// artifacts:
//   1. A husky-managed `.husky/pre-commit` line that runs `chemag check`
//      before every commit (the deterministic gate). Same one-liner as the
//      Cursor / Codex installers.
//   2. `.aider/CONVENTIONS.md` regenerated via the rules-emitter library
//      (the AI-context layer Aider prepends to every prompt).
//   3. `.aider.conf.yml` with a chemag-managed block (between
//      `# chemag:aider:start` and `# chemag:aider:end` line markers) wiring
//      a chemag entry into Aider's `auto-commands` so the model runs
//      `chemag check-edit` after each /edit. Idempotent — re-running over a
//      file that already has the markers updates the block in place.
//
// We do NOT delegate the .aider/CONVENTIONS.md step to `cmdEmitRules`; that
// would be cross-CLI delegation. Instead we follow the explicit 5-step
// library flow documented inline below, calling the same library primitives
// that `cmdEmitRules` calls. The byte-parity test enforces equality.
//
// `_backup.ts` is NOT consumed here — every artifact this installer writes
// is line- or marker-tagged, so uninstall is a precise strip rather than a
// whole-file restore.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";
import { discoverCompounds, loadCompound, loadWorkspace } from "@chemag/core/loader";
import {
  buildRulesContent,
  emitAiderConventions,
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

export interface InstallAiderOpts {
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  /**
   * Mode flag — accepted for surface symmetry with the Claude Code
   * installer but ignored for Aider (no deterministic editor hook to
   * downgrade). The installer surfaces an informational note when a
   * non-default mode is passed.
   */
  mode: "block" | "warn" | "context-only";
  dryRun: boolean;
}

export interface UninstallAiderOpts {
  workspaceRoot: string;
  dryRun: boolean;
}

/**
 * Distinct from `InstallResult` in claude-code.ts because Aider's
 * deliverables span three artifacts, not one settings file. Each artifact
 * carries its own per-write summary so the CLI can surface them.
 */
export interface AiderInstallResult {
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  precommit: ArtifactStatus;
  conventions: ArtifactStatus;
  aiderConf: ArtifactStatus;
  /**
   * Informational notes that are not errors — e.g. "mode flag ignored for
   * aider". Surfaced verbatim by the CLI.
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

/** Thrown when `.aider.conf.yml` exists but is not valid YAML. */
export class AiderConfInvalidYamlError extends Error {
  readonly path: string;
  readonly reason: string;

  constructor(filePath: string, reason: string) {
    super(`.aider.conf.yml at ${filePath} is not valid YAML: ${reason}`);
    this.name = "AiderConfInvalidYamlError";
    this.path = filePath;
    this.reason = reason;
  }
}

// Re-export so the install-hooks command can catch.
export { HuskyNotDetectedError } from "./cursor.js";
export { PrecommitUnparseableError } from "./_husky.js";

/** Marker pair for the chemag block inside `.aider.conf.yml`. */
const AIDER_CONF_MARKER_START = "# chemag:aider:start";
const AIDER_CONF_MARKER_END = "# chemag:aider:end";

/**
 * Install chemag's Aider integration. Idempotent — re-running over an
 * unchanged workspace produces byte-equal `.husky/pre-commit`,
 * `.aider/CONVENTIONS.md`, and `.aider.conf.yml`.
 *
 * Throws:
 *   * `HuskyNotDetectedError` — CHEM-INSTALL-HOOKS-007.
 *   * `PrecommitUnparseableError` — CHEM-INSTALL-HOOKS-008.
 *   * `AiderConfInvalidYamlError` — CHEM-INSTALL-HOOKS-009.
 */
export function installAider(opts: InstallAiderOpts): AiderInstallResult {
  const infoNotes = collectInfoNotes(opts);

  // ---- Step 1. Detect husky ----
  const husky = detectHusky(opts.workspaceRoot);
  if (!husky.detected) {
    throw new HuskyNotDetectedError(opts.workspaceRoot);
  }

  // ---- Step 2. Append the chemag pre-commit line ----
  const precommit = installPrecommit(husky.precommitPath, opts.dryRun);

  // ---- Step 3. Re-emit `.aider/CONVENTIONS.md` via the 5-step library flow ----
  const conventions = installConventions(opts.workspaceRoot, opts.dryRun);

  // ---- Step 4. Update `.aider.conf.yml` ----
  const aiderConf = installAiderConf(opts.workspaceRoot, opts.dryRun);

  return {
    workspaceRoot: opts.workspaceRoot,
    precommit,
    conventions,
    aiderConf,
    infoNotes,
  };
}

/**
 * Uninstall chemag's Aider integration. Removes the chemag pre-commit line
 * and the chemag block from `.aider.conf.yml`. Does NOT delete
 * `.aider/CONVENTIONS.md` — same policy as Codex's AGENTS.md.
 */
export function uninstallAider(opts: UninstallAiderOpts): AiderInstallResult {
  const husky = detectHusky(opts.workspaceRoot);

  const precommit = uninstallPrecommit(husky.precommitPath, opts.dryRun);
  const aiderConf = uninstallAiderConf(opts.workspaceRoot, opts.dryRun);

  // .aider/CONVENTIONS.md is intentionally preserved on uninstall.
  const conventionsPath = path.join(opts.workspaceRoot, ".aider/CONVENTIONS.md");
  const conventions: ArtifactStatus = {
    path: conventionsPath,
    action: "skip",
  };

  return {
    workspaceRoot: opts.workspaceRoot,
    precommit,
    conventions,
    aiderConf,
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

function installConventions(workspaceRoot: string, dryRun: boolean): ArtifactStatus {
  // The 5-step library flow:
  //   1. loadWorkspace
  //   2. discoverCompounds
  //   3. buildRulesContent
  //   4. emitAiderConventions   (content-only)
  //   5. mergeBetweenMarkers + write

  // Step 1
  const wsPath = path.join(workspaceRoot, "workspace.yaml");
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
  const file = emitAiderConventions(content);

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
    console.warn(`aider: ${w}`);
  }
  for (const w of merged.warnings) {
    console.warn(`aider: ${w}`);
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
 * Manage the chemag block inside `.aider.conf.yml`.
 *
 * Strategy: we treat the YAML file as a line-oriented text document with
 * marker comments delimiting our region. We never re-emit the user's
 * non-chemag YAML — the `yaml` library round-trip would lose comments,
 * formatting, and key ordering. We DO parse the file to validate it as YAML
 * (so we surface CHEM-INSTALL-HOOKS-009 on syntax errors) before touching
 * it; we just don't use the parsed AST for serialization.
 */
function installAiderConf(workspaceRoot: string, dryRun: boolean): ArtifactStatus {
  const filePath = path.join(workspaceRoot, ".aider.conf.yml");
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;

  if (existing !== null) {
    // Validate-only: throw CHEM-INSTALL-HOOKS-009 if the existing file is
    // unparseable. We never serialize the parsed result.
    try {
      yamlParse(existing);
    } catch (e) {
      throw new AiderConfInvalidYamlError(filePath, (e as Error).message);
    }
  }

  const newBody = mergeAiderConfBlock(existing);
  const action: ArtifactStatus["action"] =
    existing === null ? "create" : existing === newBody ? "no-op" : "update";

  if (!dryRun && action !== "no-op") {
    fs.writeFileSync(filePath, newBody, "utf-8");
  }

  return { path: filePath, action };
}

/**
 * Build the chemag block contents (between the start/end markers, exclusive).
 * Plain YAML — `auto-commands` is a list of shell commands Aider runs after
 * each `/edit` operation.
 */
function buildAiderConfBlockContent(): string {
  return [
    "# Managed by chemag — do not edit manually between the start/end markers.",
    "auto-commands:",
    '  - "chemag check-edit"',
  ].join("\n");
}

/**
 * Merge the chemag block into the existing `.aider.conf.yml`. If the file
 * is null we synthesize a minimal one carrying just the chemag block. If the
 * file already has chemag markers, we splice the regenerated block between
 * them. Otherwise we append the markers + block to the end of the file.
 *
 * Idempotent: when the regenerated block matches the existing block, the
 * returned body is byte-equal to `existing`.
 */
function mergeAiderConfBlock(existing: string | null): string {
  const blockContent = buildAiderConfBlockContent();
  const block = `${AIDER_CONF_MARKER_START}\n${blockContent}\n${AIDER_CONF_MARKER_END}`;

  if (existing === null) {
    return `${block}\n`;
  }

  const startIdx = existing.indexOf(AIDER_CONF_MARKER_START);
  const endIdx = existing.indexOf(AIDER_CONF_MARKER_END, startIdx >= 0 ? startIdx : 0);

  if (startIdx === -1 || endIdx === -1) {
    // No markers yet — append. Preserve any trailing newline state by
    // ensuring exactly one blank line separates the user's content from the
    // chemag block.
    const trimmed = existing.replace(/\n+$/, "");
    return `${trimmed}\n\n${block}\n`;
  }

  // Splice. Keep everything before the start marker and everything after the
  // end marker (plus marker length).
  const before = existing.slice(0, startIdx);
  const afterStart = endIdx + AIDER_CONF_MARKER_END.length;
  const after = existing.slice(afterStart);
  return `${before}${block}${after}`;
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

/**
 * Strip the chemag block (start..end markers, inclusive) from
 * `.aider.conf.yml`. If the file had only the chemag block, delete it.
 * Otherwise rewrite without the block.
 */
function uninstallAiderConf(workspaceRoot: string, dryRun: boolean): ArtifactStatus {
  const filePath = path.join(workspaceRoot, ".aider.conf.yml");
  if (!fs.existsSync(filePath)) {
    return { path: filePath, action: "skip" };
  }

  const existing = fs.readFileSync(filePath, "utf-8");
  const startIdx = existing.indexOf(AIDER_CONF_MARKER_START);
  const endIdx = existing.indexOf(AIDER_CONF_MARKER_END, startIdx >= 0 ? startIdx : 0);
  if (startIdx === -1 || endIdx === -1) {
    return { path: filePath, action: "skip" };
  }

  // Drop the block + the surrounding blank line (if any).
  const before = existing.slice(0, startIdx).replace(/\n+$/, "");
  const afterStart = endIdx + AIDER_CONF_MARKER_END.length;
  const after = existing.slice(afterStart).replace(/^\n+/, "");

  let body: string | null;
  if (before.trim() === "" && after.trim() === "") {
    body = null;
  } else if (before === "") {
    body = `${after}\n`.replace(/\n+$/, "\n");
  } else if (after === "") {
    body = `${before}\n`;
  } else {
    body = `${before}\n\n${after}\n`.replace(/\n+$/, "\n");
  }

  if (!dryRun) {
    if (body === null) {
      fs.unlinkSync(filePath);
    } else {
      fs.writeFileSync(filePath, body, "utf-8");
    }
  }
  return { path: filePath, action: "update" };
}

function collectInfoNotes(opts: InstallAiderOpts): string[] {
  const notes: string[] = [];
  if (opts.mode !== "block") {
    notes.push(
      `--mode "${opts.mode}" is accepted for symmetry but ignored for aider (no deterministic editor hook).`,
    );
  }
  return notes;
}

// Re-export the canonical line so tests can assert exact equality without
// reaching into _husky.ts.
export { CHEMAG_PRECOMMIT_LINE };
export { AIDER_CONF_MARKER_START, AIDER_CONF_MARKER_END };
