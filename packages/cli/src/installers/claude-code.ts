// ---------------------------------------------------------------------------
// Claude Code hook installer.
//
// Writes `chemag check-edit --for-hook claude` (PreToolUse) and
// `chemag analyze --for-hook claude` (PostToolUse) entries into
// `.claude/settings.json` (project) or `~/.claude/settings.json` (user).
//
// Modes:
//   block (default) — both PreToolUse + PostToolUse installed; PreToolUse
//                     denies on violation.
//   warn            — same matchers; PreToolUse passes `--mode warn` so
//                     the deny is downgraded to "ask".
//   context-only    — only PostToolUse installed (PreToolUse omitted).
//
// Each chemag entry is tagged `_chemag: true` so uninstall can find them.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  hasChemagHooks,
  mergeChemagHooks,
  removeChemagHooks,
  serializeSettings,
  type ChemagHookSpec,
  type ClaudeSettings,
} from "./_settings-merge.js";
import { restoreFromBackup, writeBackupOnce } from "./_backup.js";

export type InstallScope = "user" | "project";
export type InstallMode = "block" | "warn" | "context-only";

export interface InstallOpts {
  scope: InstallScope;
  mode: InstallMode;
  dryRun: boolean;
  /** Absolute path to the project root (workspace.yaml's directory). */
  workspaceRoot: string;
  /** Override $HOME for testing user-scope installs. */
  homeDirOverride?: string;
}

export interface UninstallOpts {
  scope: InstallScope;
  /** When true, copy <settings>.bak back over <settings> instead of
   *  scrubbing chemag entries from the live file. */
  restore: boolean;
  dryRun: boolean;
  workspaceRoot: string;
  homeDirOverride?: string;
}

export interface InstallResult {
  /** The absolute settings.json path that was (or would be) written. */
  settingsPath: string;
  /** True if the on-disk file was actually modified. */
  changed: boolean;
  /** True if a `.bak` was created on this run. */
  backupCreated: boolean;
  /** The merged settings (post-merge, pre-write) — useful for dry-run output. */
  finalSettings: ClaudeSettings;
}

/** Resolve the settings.json path for a given scope. */
export function getClaudeSettingsPath(
  scope: InstallScope,
  workspaceRoot: string,
  homeDirOverride?: string,
): string {
  if (scope === "project") {
    return path.join(workspaceRoot, ".claude", "settings.json");
  }
  const home = homeDirOverride ?? os.homedir();
  return path.join(home, ".claude", "settings.json");
}

/**
 * Build the chemag hook specs for a given mode. Matcher is `Edit|Write` only
 * — `MultiEdit` is not a Claude Code tool (multi-file edits arrive as
 * separate `Edit` calls, each triggering its own PreToolUse hook).
 */
export function buildChemagHookSpecs(mode: InstallMode): ChemagHookSpec[] {
  const matcher = "Edit|Write";

  // PostToolUse is informational regardless of mode.
  const postToolUse: ChemagHookSpec = {
    event: "PostToolUse",
    matcher,
    command: 'chemag analyze --for-hook claude --format json --workspace "$CLAUDE_PROJECT_DIR"',
  };

  if (mode === "context-only") {
    return [postToolUse];
  }

  // block (default) → no --mode flag (block IS the default for check-edit).
  // warn            → emit `--mode warn` so violations downgrade to "ask".
  const preCmd =
    mode === "warn"
      ? 'chemag check-edit --for-hook claude --mode warn --format json --workspace "$CLAUDE_PROJECT_DIR"'
      : 'chemag check-edit --for-hook claude --format json --workspace "$CLAUDE_PROJECT_DIR"';

  return [{ event: "PreToolUse", matcher, command: preCmd }, postToolUse];
}

/**
 * Install (or update) the chemag hooks for Claude Code. Idempotent — running
 * twice with the same options produces a byte-identical settings.json.
 */
export function installClaudeCode(opts: InstallOpts): InstallResult {
  const settingsPath = getClaudeSettingsPath(opts.scope, opts.workspaceRoot, opts.homeDirOverride);

  const existing = readSettings(settingsPath);
  const specs = buildChemagHookSpecs(opts.mode);
  const next = mergeChemagHooks(existing, specs);

  const before = existing === null ? "" : serializeSettings(existing);
  const after = serializeSettings(next);
  const changed = before !== after;

  let backupCreated = false;
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    if (changed) {
      backupCreated = writeBackupOnce(settingsPath);
      fs.writeFileSync(settingsPath, after, "utf-8");
    }
  }

  return { settingsPath, changed, backupCreated, finalSettings: next };
}

/** Uninstall chemag hooks (or restore from .bak if `--restore`). */
export function uninstallClaudeCode(opts: UninstallOpts): InstallResult {
  const settingsPath = getClaudeSettingsPath(opts.scope, opts.workspaceRoot, opts.homeDirOverride);

  if (opts.restore) {
    // Restore from .bak. If no backup exists, treat this as a no-op (the
    // caller surfaces a warning).
    if (!opts.dryRun) {
      restoreFromBackup(settingsPath);
    }
    const after = readSettings(settingsPath) ?? {};
    return {
      settingsPath,
      changed: true,
      backupCreated: false,
      finalSettings: after,
    };
  }

  const existing = readSettings(settingsPath);
  const next = removeChemagHooks(existing);

  const before = existing === null ? "" : serializeSettings(existing);
  const after = existing === null ? "" : serializeSettings(next);
  const changed = before !== after;

  if (!opts.dryRun && changed) {
    if (Object.keys(next).length === 0) {
      // Settings file is now empty — write `{}` rather than deleting so the
      // shape stays predictable for hosts that read it.
      fs.writeFileSync(settingsPath, `${JSON.stringify({}, null, 2)}\n`, "utf-8");
    } else {
      fs.writeFileSync(settingsPath, after, "utf-8");
    }
  }

  return { settingsPath, changed, backupCreated: false, finalSettings: next };
}

/** True if the target settings file already contains chemag hook entries. */
export function isAlreadyInstalled(settingsPath: string): boolean {
  return hasChemagHooks(readSettings(settingsPath));
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function readSettings(settingsPath: string): ClaudeSettings | null {
  if (!fs.existsSync(settingsPath)) return null;
  const raw = fs.readFileSync(settingsPath, "utf-8");
  if (raw.trim() === "") return null;
  try {
    return JSON.parse(raw) as ClaudeSettings;
  } catch (e) {
    // Surface a typed error — the command translates it to
    // CHEM-INSTALL-HOOKS-002.
    throw new SettingsParseError(settingsPath, e instanceof Error ? e.message : String(e));
  }
}

/** Thrown when settings.json exists but isn't valid JSON. */
export class SettingsParseError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`Settings file is not valid JSON: ${path} (${reason})`);
    this.name = "SettingsParseError";
  }
}
