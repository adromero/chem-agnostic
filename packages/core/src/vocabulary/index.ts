// ---------------------------------------------------------------------------
// Vocabulary system — i18n-style key-based translation for all user-facing
// strings.
//
// All user-visible text in chem-ag flows through tr(key, params). Two locales
// ship today: "standard" (default, language-agnostic) and "chemistry"
// (chemistry metaphor — element/molecule/reaction/etc.).
//
// Two-phase resolution
// --------------------
// The CLI dispatcher exits before any workspace is loaded for --help/--version
// and dispatches to commands which call loadWorkspace themselves. So precedence
// (flag > env > workspace.yaml > default) is split into two phases:
//
//   Phase 1 — cli.ts (always runs):
//     resolveCliVocabulary(argv, env) computes flag/env/default, then
//     setVocabulary(name, source) is called once before dispatch. This is what
//     --help, --version, and any pre-workspace error messages render with.
//
//   Phase 2 — commands that load a workspace:
//     after a successful loadWorkspace(), the command calls
//     applyWorkspaceVocabulary(workspace). If Phase 1 already saw a flag or
//     env source, this call is a no-op (those outrank the workspace.yaml
//     field). Otherwise it sets the vocabulary from workspace.vocabulary.
//
// Per-command --help text uses Phase-1 vocabulary only — workspace-sourced
// vocabulary is never applied to help text because help exits before any
// workspace is loaded. This is a documented limitation.
// ---------------------------------------------------------------------------

import standardLocale from "./standard.json" with { type: "json" };
import chemistryLocale from "./chemistry.json" with { type: "json" };
import type { TrKey } from "./keys.js";
import type { VocabularyName, Workspace } from "../types.js";

export type { VocabularyName } from "../types.js";
export type VocabularySource = "flag" | "env" | "workspace" | "default";

// Higher number = stronger source. setVocabulary only accepts a write if the
// caller's source is >= the source already recorded.
const SOURCE_RANK: Record<VocabularySource, number> = {
  default: 0,
  workspace: 1,
  env: 2,
  flag: 3,
};

const LOCALES: Record<VocabularyName, Record<string, string>> = {
  standard: standardLocale as Record<string, string>,
  chemistry: chemistryLocale as Record<string, string>,
};

// Module-local state. Both phases mutate this; tests reset via __resetForTesting.
let currentVocabulary: VocabularyName = "standard";
let currentSource: VocabularySource = "default";
const warnedKeys = new Set<string>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Translate a key to the current vocabulary. Substitutes `{name}` placeholders
 * from `params` if provided. Missing keys return `[!key]` and emit a one-shot
 * console.warn (no throw).
 */
export function tr(key: TrKey, params?: Record<string, string | number>): string {
  const locale = LOCALES[currentVocabulary];
  const template = locale[key];

  if (template === undefined) {
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      // eslint-disable-next-line no-console
      console.warn(`[chemag:vocabulary] missing key "${key}" in locale "${currentVocabulary}"`);
    }
    return `[!${key}]`;
  }

  if (!params) return template;
  return interpolate(template, params);
}

/**
 * Set the active vocabulary. The `source` parameter records who set it; a
 * weaker source (workspace) cannot overwrite a stronger source (flag/env)
 * already established this process.
 *
 * Returns true if the write was accepted, false if it was ignored due to
 * precedence.
 */
export function setVocabulary(name: VocabularyName, source: VocabularySource): boolean {
  if (SOURCE_RANK[source] < SOURCE_RANK[currentSource]) {
    return false;
  }
  currentVocabulary = name;
  currentSource = source;
  return true;
}

/**
 * Returns the active vocabulary name.
 */
export function getVocabulary(): VocabularyName {
  return currentVocabulary;
}

/**
 * Returns the current vocabulary source rank — used in tests to verify
 * precedence behaviour.
 */
export function getVocabularySource(): VocabularySource {
  return currentSource;
}

/**
 * Phase-2 helper — apply workspace.vocabulary if Phase 1 has not already
 * settled the value with a stronger source (flag or env). No-op when the
 * workspace doesn't declare a vocabulary or when a stronger source already
 * won.
 */
export function applyWorkspaceVocabulary(ws: Workspace): void {
  if (!ws.vocabulary) return;
  setVocabulary(ws.vocabulary, "workspace");
}

/**
 * Phase-1 resolution — pure function. Reads --vocabulary flag from argv
 * (preferring `--vocabulary <value>` and `--vocabulary=<value>`), then
 * CHEMAG_VOCABULARY env var, then falls back to "standard" / "default".
 *
 * Validates the value: an unknown vocabulary name is silently ignored at the
 * argv level here (cli.ts is the right place to surface a hard error if
 * desired), so this function never throws.
 */
export function resolveCliVocabulary(
  argv: string[],
  env: NodeJS.ProcessEnv,
): { name: VocabularyName; source: VocabularySource } {
  // 1. Flag — search for --vocabulary <name> or --vocabulary=<name>
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vocabulary") {
      const v = argv[i + 1];
      if (isVocabularyName(v)) return { name: v, source: "flag" };
    } else if (a.startsWith("--vocabulary=")) {
      const v = a.slice("--vocabulary=".length);
      if (isVocabularyName(v)) return { name: v, source: "flag" };
    }
  }

  // 2. Env
  const envVal = env.CHEMAG_VOCABULARY;
  if (envVal !== undefined && isVocabularyName(envVal)) {
    return { name: envVal, source: "env" };
  }

  // 3. Default
  return { name: "standard", source: "default" };
}

/**
 * True if `value` is a known VocabularyName.
 */
export function isVocabularyName(value: unknown): value is VocabularyName {
  return value === "standard" || value === "chemistry";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset module-local state to factory defaults. Tests use this in beforeEach
 * to keep cases isolated.
 */
export function __resetForTesting(): void {
  currentVocabulary = "standard";
  currentSource = "default";
  warnedKeys.clear();
}

export type { TrKey } from "./keys.js";
