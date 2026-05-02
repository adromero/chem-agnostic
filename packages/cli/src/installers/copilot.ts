// ---------------------------------------------------------------------------
// GitHub Copilot hook installer.
//
// Copilot reads `.github/copilot-instructions.md` and a coordinating CI
// workflow is the natural enforcement layer for PR-level violations, so
// `chemag install-hooks --tool copilot` writes three artifacts:
//   1. A husky-managed `.husky/pre-commit` line that runs `chemag check`
//      before every commit. Same one-liner as the other installers.
//   2. `.github/copilot-instructions.md` regenerated via the rules-emitter
//      library (the AI-context layer Copilot reads).
//   3. `.github/workflows/chemag-pr.yml` — a GitHub Action that runs
//      `chemag check` and `chemag analyze` on PRs against `main`.
//      Idempotent — if the file exists with the chemag-managed header
//      `# chemag-pr.yml managed by chemag install-hooks`, regenerate;
//      otherwise refuse to overwrite (CHEM-INSTALL-HOOKS-010) unless
//      `--overwrite`.
//
// We do NOT delegate the .github/copilot-instructions.md step to
// `cmdEmitRules`. The 5-step library flow used here matches the Cursor
// and Codex installers; the byte-parity test enforces equality with
// `chemag emit-rules --tool copilot`.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverCompounds, loadCompound, loadWorkspace } from "@chemag/core/loader";
import {
  buildRulesContent,
  emitCopilotInstructions,
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

export interface InstallCopilotOpts {
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  /**
   * Mode flag — accepted for surface symmetry with the Claude Code
   * installer but ignored for Copilot. The installer surfaces an
   * informational note when a non-default mode is passed.
   */
  mode: "block" | "warn" | "context-only";
  dryRun: boolean;
  /**
   * Replace `.github/workflows/chemag-pr.yml` even when it lacks the
   * chemag-managed header. Defaults to false.
   */
  overwrite?: boolean;
}

export interface UninstallCopilotOpts {
  workspaceRoot: string;
  dryRun: boolean;
}

/**
 * Distinct from `InstallResult` in claude-code.ts because Copilot's
 * deliverables span three artifacts.
 */
export interface CopilotInstallResult {
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  precommit: ArtifactStatus;
  copilotInstructions: ArtifactStatus;
  prWorkflow: ArtifactStatus;
  /**
   * Informational notes that are not errors — e.g. "mode flag ignored for
   * copilot". Surfaced verbatim by the CLI.
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

/**
 * Thrown when `.github/workflows/chemag-pr.yml` exists without the
 * chemag-managed header and `--overwrite` was not passed.
 */
export class CopilotWorkflowExistsNoOverwriteError extends Error {
  readonly path: string;

  constructor(filePath: string) {
    super(
      `.github/workflows/chemag-pr.yml at ${filePath} exists without the chemag-managed header`,
    );
    this.name = "CopilotWorkflowExistsNoOverwriteError";
    this.path = filePath;
  }
}

// Re-export so the install-hooks command can catch.
export { HuskyNotDetectedError } from "./cursor.js";
export { PrecommitUnparseableError } from "./_husky.js";

/** Header that marks a chemag-managed workflow file (idempotent regeneration). */
export const CHEMAG_PR_WORKFLOW_HEADER = "# chemag-pr.yml managed by chemag install-hooks";

/**
 * Install chemag's Copilot integration. Idempotent — re-running over an
 * unchanged workspace produces byte-equal `.husky/pre-commit`,
 * `.github/copilot-instructions.md`, and `.github/workflows/chemag-pr.yml`.
 *
 * Throws:
 *   * `HuskyNotDetectedError` — CHEM-INSTALL-HOOKS-007.
 *   * `PrecommitUnparseableError` — CHEM-INSTALL-HOOKS-008.
 *   * `CopilotWorkflowExistsNoOverwriteError` — CHEM-INSTALL-HOOKS-010.
 */
export function installCopilot(opts: InstallCopilotOpts): CopilotInstallResult {
  const infoNotes = collectInfoNotes(opts);

  // ---- Step 1. Detect husky ----
  const husky = detectHusky(opts.workspaceRoot);
  if (!husky.detected) {
    throw new HuskyNotDetectedError(opts.workspaceRoot);
  }

  // ---- Step 2. Append the chemag pre-commit line ----
  const precommit = installPrecommit(husky.precommitPath, opts.dryRun);

  // ---- Step 3. Re-emit `.github/copilot-instructions.md` via the 5-step library flow ----
  const copilotInstructions = installCopilotInstructions(opts.workspaceRoot, opts.dryRun);

  // ---- Step 4. Write `.github/workflows/chemag-pr.yml` ----
  const prWorkflow = installPrWorkflow(opts.workspaceRoot, opts.dryRun, opts.overwrite ?? false);

  return {
    workspaceRoot: opts.workspaceRoot,
    precommit,
    copilotInstructions,
    prWorkflow,
    infoNotes,
  };
}

/**
 * Uninstall chemag's Copilot integration. Removes the chemag pre-commit
 * line and removes `.github/workflows/chemag-pr.yml` only when it carries
 * the chemag-managed header. Does NOT delete
 * `.github/copilot-instructions.md` — same policy as Codex's AGENTS.md.
 */
export function uninstallCopilot(opts: UninstallCopilotOpts): CopilotInstallResult {
  const husky = detectHusky(opts.workspaceRoot);

  const precommit = uninstallPrecommit(husky.precommitPath, opts.dryRun);
  const prWorkflow = uninstallPrWorkflow(opts.workspaceRoot, opts.dryRun);

  // .github/copilot-instructions.md is intentionally preserved on uninstall.
  const copilotPath = path.join(opts.workspaceRoot, ".github/copilot-instructions.md");
  const copilotInstructions: ArtifactStatus = {
    path: copilotPath,
    action: "skip",
  };

  return {
    workspaceRoot: opts.workspaceRoot,
    precommit,
    copilotInstructions,
    prWorkflow,
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

function installCopilotInstructions(workspaceRoot: string, dryRun: boolean): ArtifactStatus {
  // The 5-step library flow:
  //   1. loadWorkspace
  //   2. discoverCompounds
  //   3. buildRulesContent
  //   4. emitCopilotInstructions   (content-only)
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
  const file = emitCopilotInstructions(content);

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
    console.warn(`copilot: ${w}`);
  }
  for (const w of merged.warnings) {
    console.warn(`copilot: ${w}`);
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

/**
 * Read the chemag-pr.yml template. Search a few candidate paths so the
 * function works under both `tsc` (running from `dist/installers/`) and
 * `vitest` (running from `src/installers/`).
 */
function readPrWorkflowTemplate(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const candidates = [
    // src/installers/copilot.ts -> src/installers/scripts/chemag-pr.yml.tpl
    path.join(__dirname, "scripts", "chemag-pr.yml.tpl"),
    // dist/installers/copilot.js -> dist/installers/scripts/chemag-pr.yml.tpl
    path.join(__dirname, "..", "installers", "scripts", "chemag-pr.yml.tpl"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf-8");
    }
  }
  throw new Error(
    `copilot: chemag-pr.yml.tpl template not found in any of: ${candidates.join(", ")}`,
  );
}

/**
 * Write `.github/workflows/chemag-pr.yml`. Idempotent.
 *
 * If the file does not exist → create it.
 * If the file exists with the chemag-managed header → regenerate it.
 * If the file exists WITHOUT the chemag-managed header → throw
 * `CopilotWorkflowExistsNoOverwriteError` unless `overwrite` is true.
 */
function installPrWorkflow(
  workspaceRoot: string,
  dryRun: boolean,
  overwrite: boolean,
): ArtifactStatus {
  const filePath = path.join(workspaceRoot, ".github/workflows/chemag-pr.yml");
  const template = readPrWorkflowTemplate();

  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;

  if (existing !== null) {
    const hasHeader = existing.startsWith(CHEMAG_PR_WORKFLOW_HEADER);
    if (!hasHeader && !overwrite) {
      throw new CopilotWorkflowExistsNoOverwriteError(filePath);
    }
  }

  const action: ArtifactStatus["action"] =
    existing === null ? "create" : existing === template ? "no-op" : "update";

  if (!dryRun && action !== "no-op") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, template, "utf-8");
  }

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

/**
 * Strip `.github/workflows/chemag-pr.yml` only when it has the
 * chemag-managed header. Hand-written workflow files survive uninstall
 * untouched.
 */
function uninstallPrWorkflow(workspaceRoot: string, dryRun: boolean): ArtifactStatus {
  const filePath = path.join(workspaceRoot, ".github/workflows/chemag-pr.yml");
  if (!fs.existsSync(filePath)) {
    return { path: filePath, action: "skip" };
  }

  const existing = fs.readFileSync(filePath, "utf-8");
  if (!existing.startsWith(CHEMAG_PR_WORKFLOW_HEADER)) {
    return { path: filePath, action: "skip" };
  }

  if (!dryRun) {
    fs.unlinkSync(filePath);
  }
  return { path: filePath, action: "update" };
}

function collectInfoNotes(opts: InstallCopilotOpts): string[] {
  const notes: string[] = [];
  if (opts.mode !== "block") {
    notes.push(
      `--mode "${opts.mode}" is accepted for symmetry but ignored for copilot (no deterministic editor hook).`,
    );
  }
  return notes;
}

// Re-export the canonical line so tests can assert exact equality without
// reaching into _husky.ts.
export { CHEMAG_PRECOMMIT_LINE };
