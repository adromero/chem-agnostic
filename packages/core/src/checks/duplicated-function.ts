// ---------------------------------------------------------------------------
// CHEM-DRY-001 — function declared in N+ non-test files.
//
// Pure, independently testable check used by the analyze phase
// (`import-check.ts`). For each function NAME that appears as a top-level
// `FunctionDeclaration` in N or more distinct non-test files (and that is
// not in the user-configurable exclude list), emit ONE suggestion-level
// diagnostic listing every duplicate location.
//
// Architectural choice: filtering (test-file exclusion, exclude-list,
// threshold) lives in CORE so the plugin can stay AST-only. Plugins that
// can't enumerate top-level function declarations (plugin-python in v1)
// MAY omit `LanguagePlugin.scanFunctionDeclarations`; the orchestrator in
// `import-check.ts` then passes an empty sites map and this check emits
// nothing for that sub-tree.
// ---------------------------------------------------------------------------
import * as path from "node:path";
import type { LanguagePlugin } from "../plugin-interface.js";
import type { Diagnostic, FunctionDeclarationSite, Workspace } from "../types.js";
import { tr } from "../vocabulary/index.js";
import { isTestPath } from "./port-class-import.js";

/**
 * Default threshold for `CHEM-DRY-001`. A function name must appear in this
 * many or more distinct non-test files before the rule fires. Overridable
 * via `workspace.rules.duplicate_function_threshold`.
 */
export const DEFAULT_DUPLICATE_FUNCTION_THRESHOLD = 3;

/**
 * Default exclude list. Names that match a test-framework lifecycle hook are
 * exempt by default because duplicating them is the expected pattern — one
 * `beforeEach` per test file is idiomatic. Configurable (and REPLACED, not
 * extended) by `workspace.rules.duplicate_function_exclude`.
 */
export const DEFAULT_DUPLICATE_FUNCTION_EXCLUDE: readonly string[] = Object.freeze([
  "setup",
  "teardown",
  "beforeEach",
  "afterEach",
]);

export interface DuplicatedFunctionInput {
  /**
   * Per-file map of top-level function declarations, as produced by
   * `LanguagePlugin.scanFunctionDeclarations`. Empty (or missing entries)
   * means "nothing to check" for those files.
   */
  sites: Map<string, FunctionDeclarationSite[]>;
  /** The active workspace — read for `rules.duplicate_function_*`. */
  workspace: Workspace;
  /** Language plugin — used by `isTestPath` for the canonical test pattern. */
  plugin: LanguagePlugin;
  /** Sub-tree id, threaded through to each diagnostic's `language_id`. */
  subtreeId: string | undefined;
}

/**
 * Run CHEM-DRY-001 over a single sub-tree's function-declaration scan.
 *
 * Emits ONE diagnostic per duplicated name (NOT one per occurrence), with
 * a single concatenated `locations` parameter listing every duplicate file.
 */
export function checkDuplicatedFunction(input: DuplicatedFunctionInput): Diagnostic[] {
  const { sites, workspace, plugin, subtreeId } = input;

  const threshold =
    workspace.rules?.duplicate_function_threshold ?? DEFAULT_DUPLICATE_FUNCTION_THRESHOLD;
  // Replace-semantics: if the user supplies the field, they own the list.
  const exclude = new Set<string>(
    workspace.rules?.duplicate_function_exclude ?? DEFAULT_DUPLICATE_FUNCTION_EXCLUDE,
  );

  // Invert the per-file map into a per-name map of distinct file paths.
  // Use a Set keyed by absPath so a single file declaring the same function
  // twice (legal in TS via overload signatures — the second is the impl) is
  // counted once.
  const byName = new Map<string, Set<string>>();
  for (const [absPath, fileSites] of sites) {
    // Test-file exclusion happens in CORE so the plugin can stay AST-only.
    if (isTestPath(absPath, plugin)) continue;

    for (const site of fileSites) {
      if (exclude.has(site.functionName)) continue;
      let bucket = byName.get(site.functionName);
      if (!bucket) {
        bucket = new Set<string>();
        byName.set(site.functionName, bucket);
      }
      bucket.add(site.absPath);
    }
  }

  const diags: Diagnostic[] = [];
  // Sort names for deterministic diagnostic ordering across runs.
  const names = [...byName.keys()].sort();
  for (const name of names) {
    const files = byName.get(name);
    if (!files || files.size < threshold) continue;

    // Sort file paths for deterministic message output.
    const sorted = [...files].sort();
    const locations = sorted.map((p) => path.basename(p)).join(", ");

    const diag: Diagnostic = {
      level: "suggestion",
      check: "duplicated-function",
      code: "CHEM-DRY-001",
      message: tr("diagnostic.dry.function_duplicated", {
        name,
        count: files.size,
        locations,
      }),
      hint:
        `Consider extracting "${name}" into a shared utility module ` +
        "and importing it from each call site.",
      // No `file` field — this is a multi-location finding spanning N files.
      // Tools that need to highlight individual sites should switch on the
      // code and surface each path from the message.
    };
    if (subtreeId !== undefined) diag.language_id = subtreeId;
    diags.push(diag);
  }

  return diags;
}
