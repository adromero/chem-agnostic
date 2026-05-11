// ---------------------------------------------------------------------------
// CHEM-PORT-004 — stateful adapter instantiation must happen in a catalyst.
//
// Pure, independently testable check used by the analyze phase
// (`import-check.ts`). Fires on `new XAdapter()` call sites where:
//
//   1. The constructor's declaring file resolves to an `adapter` unit in a
//      known compound.
//   2. The call site is NOT a catalyst compound.
//   3. The class is not annotated with `// @chemag-transient`.
//   4. The class name is not in the shared CHEM-PORT-003 allowlist.
//   5. The source file is not a test file.
//
// Mirrors `port-class-import.ts` (CHEM-PORT-003) in structure and reuse:
// the `classAllowlist` Set is built ONCE per analyze pass and threaded in,
// and `isTestPath` is shared (exported from `port-class-import.ts`).
//
// AST data: the caller pre-collects `NewExpressionSite[]` per file via
// `plugin.scanNewExpressions(filePaths)` — a no-op when the plugin omits
// the method (e.g. plugin-python), in which case this check emits nothing
// for that sub-tree.
// ---------------------------------------------------------------------------
import * as path from "node:path";
import type { LanguagePlugin } from "../plugin-interface.js";
import type { Diagnostic, LoadedCompound, NewExpressionSite, Workspace } from "../types.js";
import { tr } from "../vocabulary/index.js";
import { isTestPath } from "./port-class-import.js";

/**
 * `fileIndex` row shape consumed by this check. Mirrors the local
 * `FileEntry` type inside `checkImports()` — kept structurally compatible
 * via the input shape below so callers can pass their `Map` directly.
 */
export interface PortAdapterInstantiationFileEntry {
  compound: string;
  unit: string;
  role: string;
  subtreeId: string;
}

/**
 * `compoundMap` row shape consumed by this check. Mirrors the local
 * `CompoundEntry` type inside `checkImports()`.
 */
export interface PortAdapterInstantiationCompoundEntry {
  compound: LoadedCompound;
  subtreeId: string;
}

export interface PortAdapterInstantiationInput {
  /**
   * The plugin's per-file `new` expression scan result. Files with no
   * sites MAY be absent from the map; this check treats a missing entry
   * as an empty array.
   */
  sites: Map<string, NewExpressionSite[]>;
  /** Absolute path → owning compound/unit/role/subtree. */
  fileIndex: Map<string, PortAdapterInstantiationFileEntry>;
  /** Compound name → loaded compound + sub-tree id. */
  compoundMap: Map<string, PortAdapterInstantiationCompoundEntry>;
  /** The full workspace — currently unused by the check itself but
   * threaded through for future extension (parity with R03's API). */
  workspace: Workspace;
  /** Language plugin — read for `defaults.testFilePattern`. */
  plugin: LanguagePlugin;
  /** Pre-compiled allowlist (caller computes once per analyze pass via
   * `compileClassAllowlist` in `port-class-import.ts`). */
  classAllowlist: Set<string>;
  /** Sub-tree id, threaded through to each diagnostic's `language_id`. */
  subtreeId: string | undefined;
}

/**
 * Per-sub-tree PORT-004 check.
 *
 * Returns one diagnostic per offending `new XAdapter()` call site. See file
 * header for the full guard sequence and rationale.
 */
export function checkPortAdapterInstantiation(input: PortAdapterInstantiationInput): Diagnostic[] {
  const { sites, fileIndex, compoundMap, plugin, classAllowlist, subtreeId } = input;

  const diags: Diagnostic[] = [];

  for (const [, fileSites] of sites) {
    for (const site of fileSites) {
      const diag = checkOneSite(site, fileIndex, compoundMap, plugin, classAllowlist, subtreeId);
      if (diag) diags.push(diag);
    }
  }

  return diags;
}

/**
 * Per-site decision tree. Returns 0 or 1 diagnostic. Branch order matches
 * the R04 stage spec's decision tree (cheap rejections first).
 */
function checkOneSite(
  site: NewExpressionSite,
  fileIndex: Map<string, PortAdapterInstantiationFileEntry>,
  compoundMap: Map<string, PortAdapterInstantiationCompoundEntry>,
  plugin: LanguagePlugin,
  classAllowlist: Set<string>,
  subtreeId: string | undefined,
): Diagnostic | undefined {
  // 1. Transient annotation — opt-out for stateless value-typed classes.
  if (site.isTransient) return undefined;

  // 2. Allowlist (Money, Date, URL, ...). Reuses R03's allowlist.
  if (classAllowlist.has(site.className)) return undefined;

  // 3. Test file exemption. Shared with PORT-003 via the exported helper.
  if (isTestPath(site.callerAbsPath, plugin)) return undefined;

  // 4. Resolve the class declaration file → owning unit. Skip when the
  // class lives outside any known compound (node_modules, stdlib, generated
  // code, etc.) or when its owning unit is not an adapter.
  if (site.constructorDeclAbsPath === undefined) return undefined;
  const targetInfo = fileIndex.get(site.constructorDeclAbsPath);
  if (targetInfo === undefined) return undefined;
  if (targetInfo.role !== "adapter") return undefined;

  // 5. Resolve the caller's owning compound.
  const srcInfo = fileIndex.get(site.callerAbsPath);
  if (srcInfo === undefined) return undefined;

  const srcEntry = compoundMap.get(srcInfo.compound);
  if (srcEntry === undefined) return undefined;
  const srcCompound = srcEntry.compound;

  // 6. Catalyst compounds are exempt — instantiating adapters IS their job.
  const srcType = srcCompound.manifest.type ?? "compound";
  if (srcType === "catalyst") return undefined;

  // 7. Emit.
  const diag: Diagnostic = {
    level: "error",
    check: "port-adapter-instantiation",
    code: "CHEM-PORT-004",
    compound: srcCompound.manifest.compound,
    message: tr("diagnostic.port.adapter_instantiation", {
      file: path.basename(site.callerAbsPath),
      class_name: site.className,
      src_compound: srcCompound.manifest.compound,
    }),
    hint:
      "Move the `new` into a catalyst, or annotate the class with " +
      "`// @chemag-transient` if it has no instance state.",
    file: site.callerAbsPath,
  };
  if (subtreeId !== undefined) diag.language_id = subtreeId;
  return diag;
}
