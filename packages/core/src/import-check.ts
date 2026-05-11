import * as path from "node:path";
import type {
  Workspace,
  LoadedCompound,
  Diagnostic,
  ParsedImport,
  LanguageSubtree,
} from "./types.js";
import type { LanguagePlugin } from "./plugin-interface.js";
import { tr } from "./vocabulary/index.js";
import { checkPortNeedsInterface, compileIoModulePatterns } from "./checks/port-needs-interface.js";
import { checkPortClassImport, compileClassAllowlist } from "./checks/port-class-import.js";

/**
 * One per-language sub-tree slice fed into `checkImports`. The CLI / MCP
 * orchestrator builds one entry per `workspace.languages[]` entry, paired
 * with the resolved plugin and the compounds discovered inside the
 * sub-tree's path roots.
 */
export interface ImportCheckScope {
  plugin: LanguagePlugin;
  scope: LanguageSubtree;
  compounds: LoadedCompound[];
}

/**
 * Optional hook the CLI passes when it has a cache layer. The hook is
 * invoked **once per sub-tree** with the file list for that sub-tree (and
 * the matching plugin/scope), so callers can keep their per-file content
 * cache without forcing a global rewrite of the cache layer.
 *
 * If the hook returns a non-null map, the plugin's `parseImportsBatch` is
 * bypassed for those entries. The CLI wraps the plugin call so cached
 * entries are returned from disk and missing entries are parsed once and
 * persisted.
 *
 * `scope` may be ignored by the cache implementation — file paths remain
 * absolute and unique across sub-trees, so no key collision can occur. The
 * parameter is supplied so per-sub-tree caches (rare) can partition by id.
 */
export interface CheckImportsHooks {
  parseImportsBatch?: (
    filePaths: string[],
    plugin: LanguagePlugin,
    scope: LanguageSubtree,
  ) => Map<string, ParsedImport[]>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze real import statements in source files against bond rules,
 * cross-compound import constraints, and (wp-020) cross-language sub-tree
 * boundaries.
 *
 * The orchestrator iterates each `ImportCheckScope` and invokes the
 * scope's `plugin.parseImportsBatch` (or the cache-aware hook) once per
 * sub-tree. Diagnostics from every scope are aggregated into a single list
 * and tagged with `language_id` (the source sub-tree's id).
 */
export function checkImports(
  workspace: Workspace,
  scopes: ImportCheckScope[],
  hooks: CheckImportsHooks = {},
): Diagnostic[] {
  const diags: Diagnostic[] = [];

  // Compile the effective I/O-module allowlist ONCE per analyze pass. The
  // loader has already pruned invalid `rules.io_modules` regex strings and
  // emitted CHEM-MANIFEST-005 for them, so `compileIoModulePatterns` runs
  // in its pure (non-throwing) regime here.
  const ioPatterns = compileIoModulePatterns(workspace.rules?.io_modules);

  // Compile the effective class-name allowlist for CHEM-PORT-003 ONCE per
  // analyze pass. Matches PORT-001's compile-and-cache pattern. The default
  // list ["Date","URL","Money","RegExp"] is extended (never replaced) by
  // workspace.rules.import_class_allowlist.
  const classAllowlist = compileClassAllowlist(workspace.rules?.import_class_allowlist);

  // -----------------------------------------------------------------
  // Build a GLOBAL file index that spans every sub-tree. This lets us
  // detect cross-sub-tree imports (a TS file resolving into a Python
  // file's path, etc.) without losing the per-sub-tree plugin used to
  // parse the source.
  // -----------------------------------------------------------------
  type FileEntry = {
    compound: string;
    unit: string;
    role: string;
    /** id of the sub-tree this file lives in. */
    subtreeId: string;
  };
  const fileIndex = new Map<string, FileEntry>();

  // Public-surface index — keyed by absolute path of each compound's
  // public.ts (or overridden surface file). Used by PORT-003 to map a
  // cross-compound `import { X } from "b/public"` back to compound "b" even
  // when public.ts itself is not declared as a unit (the common case).
  const surfaceIndex = new Map<string, { compound: string; subtreeId: string }>();

  // Compound name -> { loaded compound, sub-tree id } across all scopes.
  type CompoundEntry = { compound: LoadedCompound; subtreeId: string };
  const compoundMap = new Map<string, CompoundEntry>();

  // Implicit solvents are a workspace-wide concept (compound type rule).
  const implicitNames = new Set<string>();

  for (const { plugin, scope, compounds } of scopes) {
    // Compute the effective surface filename for compounds in this scope.
    // Priority: sub-tree override > workspace.rules.public_surface > plugin default.
    const surfaceFilename =
      scope.public_surface ?? workspace.rules?.public_surface ?? plugin.defaults.publicSurface;

    for (const c of compounds) {
      compoundMap.set(c.manifest.compound, { compound: c, subtreeId: scope.id });
      const typeDef = workspace.compound_types?.[c.manifest.type ?? "compound"];
      if (typeDef?.implicit) implicitNames.add(c.manifest.compound);

      for (const u of c.manifest.units ?? []) {
        const abs = path.resolve(c.dir, u.file);
        fileIndex.set(abs, {
          compound: c.manifest.compound,
          unit: u.name,
          role: u.role,
          subtreeId: scope.id,
        });
      }

      // Register the public-surface absolute path even when public.ts is not
      // declared as a unit. Powers PORT-003's compound-resolution for the
      // canonical "import { X } from 'b/public'" pattern.
      const surfaceAbs = path.resolve(c.dir, surfaceFilename);
      surfaceIndex.set(surfaceAbs, {
        compound: c.manifest.compound,
        subtreeId: scope.id,
      });
    }
  }

  // -----------------------------------------------------------------
  // Iterate sub-trees. For each, invoke the parse-batch hook (or the
  // plugin's batch parser) ONCE per sub-tree, then walk every file's
  // imports and emit diagnostics.
  // -----------------------------------------------------------------
  for (const { plugin, scope, compounds } of scopes) {
    if (compounds.length === 0) continue;

    const filesToAnalyze: { abs: string; compound: LoadedCompound }[] = [];
    for (const c of compounds) {
      for (const u of c.manifest.units ?? []) {
        const abs = path.resolve(c.dir, u.file);
        filesToAnalyze.push({ abs, compound: c });
      }
    }

    if (filesToAnalyze.length === 0) continue;

    const allFilePaths = filesToAnalyze.map((f) => f.abs);
    const batchResult = hooks.parseImportsBatch
      ? hooks.parseImportsBatch(allFilePaths, plugin, scope)
      : plugin.parseImportsBatch(allFilePaths);

    for (const { abs, compound: srcCompound } of filesToAnalyze) {
      const imports = batchResult.get(abs);
      if (!imports || imports.length === 0) continue;

      const srcInfo = fileIndex.get(abs);
      if (!srcInfo) continue;

      const srcRole = srcInfo.role;
      const allowedRoles = workspace.bonds[srcRole];

      for (const imp of imports) {
        // Resolve module specifier to absolute path via the scope's plugin.
        const resolvedPath = plugin.resolveModulePath(abs, imp.moduleSpecifier);

        // Skip external/stdlib modules (unresolvable).
        if (resolvedPath === undefined) continue;

        // Look up the resolved path in the global file index.
        let targetInfo = fileIndex.get(resolvedPath);

        // Public-surface imports — `b/public.ts` is usually NOT a declared
        // unit, so `fileIndex` misses it. Fall back to `surfaceIndex` and
        // synthesize a minimal entry so cross-compound rules (including
        // PORT-003) can fire on the canonical public-surface import path.
        // `role` is left as "" because the public surface has no role and
        // bond-check is guarded on a non-empty allowedRoles below.
        if (!targetInfo) {
          const surfaceHit = surfaceIndex.get(resolvedPath);
          if (surfaceHit) {
            targetInfo = {
              compound: surfaceHit.compound,
              unit: "",
              role: "",
              subtreeId: surfaceHit.subtreeId,
            };
          }
        }

        // Not a known chem unit or public surface — skip.
        if (!targetInfo) continue;

        const targetCompound = targetInfo.compound;
        const targetRole = targetInfo.role;
        const importedNames = imp.names.length > 0 ? imp.names.join(", ") : "(side-effect)";

        // ---- Check 0 (wp-020): Cross-language sub-tree boundary ----
        // If the resolved file lives in a different sub-tree than the
        // source file, the import crosses a language boundary. Emit
        // CHEM-IMPORT-CROSS-LANG-001 unless the source sub-tree explicitly
        // allow-lists the target sub-tree id.
        if (targetInfo.subtreeId !== srcInfo.subtreeId) {
          const allowed = scope.allowed_cross_language_imports ?? [];
          if (!allowed.includes(targetInfo.subtreeId)) {
            diags.push({
              level: "error",
              check: "import-cross-lang",
              code: "CHEM-IMPORT-CROSS-LANG-001",
              compound: srcCompound.manifest.compound,
              language_id: srcInfo.subtreeId,
              message: tr("diagnostic.cross_language_import", {
                src_id: srcInfo.subtreeId,
                target_id: targetInfo.subtreeId,
                file: path.basename(abs),
                target_compound: targetCompound,
              }),
              hint:
                `Compound "${targetCompound}" lives in sub-tree "${targetInfo.subtreeId}". ` +
                `Add "${targetInfo.subtreeId}" to languages[${srcInfo.subtreeId}].allowed_cross_language_imports to permit it explicitly.`,
              file: abs,
            });
            // Skip the per-sub-tree import-bonds / cross-compound checks for
            // a cross-language import — the cross-language diagnostic is the
            // first-class violation. Reporting downstream rule violations
            // (bond, undeclared, bypass) on a forbidden import would just
            // generate noise.
            continue;
          }
          // Allow-listed cross-language import: fall through to the
          // standard bond / cross-compound checks below so the architecture
          // rules still apply across the boundary.
        }

        // --- Check 1: Bond rules ---
        // Skip when targetRole is empty — that signals a public-surface
        // synthesized entry (no unit role attached). Bond checking on the
        // surface itself would emit spurious violations.
        if (targetRole !== "" && allowedRoles && !allowedRoles.includes(targetRole)) {
          diags.push({
            level: "error",
            check: "import-bonds",
            code: "CHEM-BOND-003",
            compound: srcCompound.manifest.compound,
            language_id: srcInfo.subtreeId,
            message: tr("diagnostic.import_bond_violation", {
              file: path.basename(abs),
              src_role: srcRole,
              target_role: targetRole,
              names: importedNames,
            }),
            hint: `${srcRole} can only import from [${allowedRoles.join(", ")}]`,
            // wp-005: source-level diagnostics MUST populate `file` (absolute path).
            file: abs,
          });
        }

        // --- Check 2: Cross-compound import rules ---
        if (targetCompound !== srcCompound.manifest.compound) {
          const crossRule = workspace.rules?.cross_compound_imports ?? "public_only";

          if (crossRule === "public_only") {
            // Resolve the public-surface filename: prefer the target
            // sub-tree's per-language override, fall back to the
            // workspace-wide `rules.public_surface`, then finally to the
            // target compound's plugin defaults.
            const targetEntry = compoundMap.get(targetCompound);
            const targetSubtree = scopes.find((s) => s.scope.id === targetEntry?.subtreeId);
            const surfaceFile =
              targetSubtree?.scope.public_surface ??
              workspace.rules?.public_surface ??
              targetSubtree?.plugin.defaults.publicSurface ??
              plugin.defaults.publicSurface;
            const targetC = targetEntry?.compound;

            if (targetC) {
              const surfaceAbs = path.resolve(targetC.dir, surfaceFile);

              // The resolved import should point to the public surface.
              if (resolvedPath !== surfaceAbs) {
                // Check if the source compound declares the target as an import.
                const isImported = (srcCompound.manifest.imports ?? []).some(
                  (i) => i.compound === targetCompound,
                );
                const isImplicit = implicitNames.has(targetCompound);

                if (!isImported && !isImplicit) {
                  diags.push({
                    level: "error",
                    check: "import-undeclared",
                    code: "CHEM-IMPORT-003",
                    compound: srcCompound.manifest.compound,
                    language_id: srcInfo.subtreeId,
                    message: tr("diagnostic.import_undeclared", {
                      file: path.basename(abs),
                      target: targetCompound,
                      src_compound: srcCompound.manifest.compound,
                    }),
                    hint: `Add "- compound: ${targetCompound}" to imports in ${srcCompound.manifest.compound}/compound.yaml`,
                    // wp-005: source-level diagnostics MUST populate `file`.
                    file: abs,
                  });
                }

                diags.push({
                  level: "error",
                  check: "import-bypass",
                  code: "CHEM-IMPORT-004",
                  compound: srcCompound.manifest.compound,
                  language_id: srcInfo.subtreeId,
                  message: tr("diagnostic.import_bypass", {
                    file: path.basename(abs),
                    target: targetCompound,
                    surface: surfaceFile,
                  }),
                  hint: `Import from "${targetCompound}/${surfaceFile}" instead`,
                  // wp-005: source-level diagnostics MUST populate `file`.
                  file: abs,
                });
              }
            }
          }

          // ---- PORT-003: concrete class import across a compound boundary ----
          // Runs AFTER the bypass/undeclared checks so PORT-003 only fires on
          // imports that have already passed the access-control gate (or on
          // workspaces with `cross_compound_imports: unrestricted`). The rule
          // itself runs regardless of crossRule mode — a concrete class
          // crossing a compound boundary defeats interface-driven architecture
          // even when access is unrestricted. The rule is about contract
          // granularity, not access control.
          const port003 = checkPortClassImport({
            srcAbs: abs,
            srcCompound,
            targetCompound: compoundMap.get(targetCompound)?.compound,
            imp,
            workspace,
            plugin,
            allowlist: classAllowlist,
            subtreeId: srcInfo.subtreeId,
          });
          if (port003.length > 0) diags.push(...port003);
        }
      }
    }

    // ---- Check 3 (PORT-001): per-compound "needs interface" check ----
    // Run AFTER the per-file diagnostic loop completes for this scope so
    // batchResult is fully populated. The check is per-compound — one
    // diagnostic at most per compound — and consumes the same parsed-import
    // map already built above via a closure that hides batchResult from the
    // pure check function.
    for (const c of compounds) {
      const portDiag = checkPortNeedsInterface(
        c,
        (abs: string) => batchResult.get(abs),
        ioPatterns,
        scope.id,
      );
      if (portDiag) diags.push(portDiag);
    }
  }

  return diags;
}
