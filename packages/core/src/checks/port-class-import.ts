// ---------------------------------------------------------------------------
// CHEM-PORT-003 — cross-compound imports of class declarations.
//
// Pure, independently testable check used by the analyze phase
// (`import-check.ts`). Fires when ALL of the following hold for a single
// cross-compound `import { X } from "..."` statement:
//
//   1. The source file is NOT a test file.
//   2. The import is NOT `import type { ... }`.
//   3. The imported statement resolves to a `class` declaration (after
//      walking `getAliasedSymbol()` chains up to depth 5).
//   4. The class name is NOT in the effective allowlist
//      (DEFAULT_CLASS_ALLOWLIST + workspace.rules.import_class_allowlist).
//   5. The target compound is NOT a reagent (or any compound_types entry
//      with `implicit: true` — e.g. solvents).
//
// Cardinality: 0 or 1 diagnostic per import statement. Multi-named imports
// (`import { A, B }`) emit one diagnostic citing the first non-allowlisted
// name, because `declarationKind` is per-statement today; a future WP can
// promote it to a per-name map without breaking this check's contract.
//
// `declarationKind === undefined` → the plugin did not resolve symbols
// (Python, namespace imports, etc.) → skip entirely (no false positives).
// `declarationKind === "unresolved"` → the resolver hit the depth cap or
// dead-ended → also skip (conservative).
// ---------------------------------------------------------------------------
import * as path from "node:path";
import type { LanguagePlugin } from "../plugin-interface.js";
import type { Diagnostic, LoadedCompound, ParsedImport, Workspace } from "../types.js";
import { tr } from "../vocabulary/index.js";

/**
 * Default allowlist of class names that may cross a compound boundary as
 * concrete imports. These are framework / standard-library types whose
 * "implementation" is effectively contract — wrapping them in an interface
 * would be a maintenance cost with no architectural payoff.
 *
 * User-supplied entries via `workspace.rules.import_class_allowlist` EXTEND
 * this list (matches R02's `compileIoModulePatterns` semantics) — they
 * never replace it.
 */
export const DEFAULT_CLASS_ALLOWLIST: readonly string[] = Object.freeze([
  "Date",
  "URL",
  "Money",
  "RegExp",
]);

/**
 * Compile the effective class-name allowlist.
 *
 * EXTEND semantics: `[...DEFAULT_CLASS_ALLOWLIST, ...userPatterns ?? []]`.
 * Names are matched literally (case-sensitive). Returns a fresh `Set` per
 * call for O(1) lookup; callers cache the result for the duration of one
 * analyze pass.
 */
export function compileClassAllowlist(userPatterns: string[] | undefined): Set<string> {
  return new Set<string>([...DEFAULT_CLASS_ALLOWLIST, ...(userPatterns ?? [])]);
}

export interface PortClassImportInput {
  /** Absolute path to the source file containing the import statement. */
  srcAbs: string;
  /** Loaded compound that owns `srcAbs`. */
  srcCompound: LoadedCompound;
  /** Loaded compound that owns the resolved import target, if any. */
  targetCompound: LoadedCompound | undefined;
  /** The parsed import statement (carries `declarationKind`). */
  imp: ParsedImport;
  /** The full workspace — read for `compound_types` and `rules`. */
  workspace: Workspace;
  /** Language plugin — read for `defaults.testFilePattern`. */
  plugin: LanguagePlugin;
  /** Pre-compiled allowlist (caller computes once per analyze pass). */
  allowlist: Set<string>;
  /** Sub-tree id, threaded through to the diagnostic's `language_id`. */
  subtreeId: string | undefined;
}

/**
 * Per-edge PORT-003 check.
 *
 * Returns 0 or 1 diagnostic per call. See file header for the full guard
 * sequence and rationale.
 */
export function checkPortClassImport(input: PortClassImportInput): Diagnostic[] {
  const { srcAbs, srcCompound, targetCompound, imp, workspace, plugin, allowlist, subtreeId } =
    input;

  // Guard 1: plugin did not opt into declaration-kind resolution (e.g. Python)
  // or the resolver explicitly gave up. Either way: skip — never emit a
  // false positive on a language that hasn't surfaced the data.
  if (imp.declarationKind === undefined) return [];
  if (imp.declarationKind === "unresolved") return [];

  // Guard 2: type-only imports never participate in runtime coupling.
  // `import type { Foo }` is safe regardless of `Foo`'s declaration kind.
  if (imp.isTypeOnly) return [];

  // Guard 3: target compound unknown — defensive; the caller already
  // filtered to known cross-compound edges, but a future caller might not.
  if (!targetCompound) return [];

  // Guard 4: test files are exempt by default. Use the plugin's canonical
  // basename regex AND directory-component checks for `/tests/` and
  // `/__tests__/`. Do NOT use `string.includes("tests")` — that would
  // misfire on paths containing `treats`, `treaty`, ...
  if (isTestPath(srcAbs, plugin)) return [];

  // Guard 5: reagent (and any implicit compound type) exports are exempt.
  // Reagents are the shared-kernel layer; their concrete types are part of
  // the contract by design.
  const targetType = targetCompound.manifest.type ?? "compound";
  const typeDef = workspace.compound_types?.[targetType];
  const isReagent = targetType === "reagent" || typeDef?.implicit === true;
  if (isReagent) return [];

  // Guard 6: only `class` declarations are violations under PORT-003.
  if (imp.declarationKind !== "class") return [];

  // Find the first non-allowlisted name. `imp.names` may include a
  // namespace sentinel like `* as foo` (declarationKind would be undefined
  // for those statements — already filtered out above), so we filter
  // defensively.
  const offendingName = imp.names.find((n) => !n.startsWith("* as") && !allowlist.has(n));
  if (offendingName === undefined) return [];

  const diag: Diagnostic = {
    level: "error",
    check: "port-class-import",
    code: "CHEM-PORT-003",
    compound: srcCompound.manifest.compound,
    message: tr("diagnostic.port_class_cross_compound", {
      file: path.basename(srcAbs),
      name: offendingName,
      target_compound: targetCompound.manifest.compound,
    }),
    hint:
      "Extract an interface for this class in the exporting compound; import the interface " +
      "instead, and bind the implementation via the catalyst.",
    file: srcAbs,
    remediation: { kind: "use_interface", interface_candidates: [] },
  };
  if (subtreeId !== undefined) diag.language_id = subtreeId;
  return [diag];
}

/**
 * Test-file detection. Uses the plugin's canonical `defaults.testFilePattern`
 * for basename matching (so e.g. TypeScript's `/\.test\.ts$/` catches
 * `foo.test.ts`) and supplements with path-component checks for the common
 * `/tests/` and `/__tests__/` directory placements that aren't covered by a
 * basename regex.
 *
 * Path-component splitting is deliberate: `string.includes("tests")` would
 * misfire on `treats.ts`, `mistreats.ts`, etc. We split on `path.sep` AND
 * `/` because `srcAbs` is typically POSIX-style even on Windows when the
 * caller constructed it via `path.resolve` on a POSIX runner.
 *
 * Exported because both CHEM-PORT-003 and CHEM-PORT-004 share this
 * test-exemption logic; duplicating it would let the two checks drift
 * silently.
 */
export function isTestPath(srcAbs: string, plugin: LanguagePlugin): boolean {
  const basename = path.basename(srcAbs);
  if (plugin.defaults.testFilePattern.test(basename)) return true;

  const segments = path.dirname(srcAbs).split(/[\\/]/);
  if (segments.includes("tests")) return true;
  if (segments.includes("__tests__")) return true;
  return false;
}
