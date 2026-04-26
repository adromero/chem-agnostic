import * as path from "node:path";
import type { Workspace, LoadedCompound, Diagnostic } from "./types.js";
import type { LanguagePlugin } from "./plugin-interface.js";
import { tr } from "./vocabulary/index.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze real import statements in source files against bond rules
 * and cross-compound import constraints.
 *
 * This is the language-agnostic orchestrator. All language-specific
 * parsing and resolution is delegated to the provided LanguagePlugin.
 */
export function checkImports(
  workspace: Workspace,
  compounds: LoadedCompound[],
  plugin: LanguagePlugin,
): Diagnostic[] {
  const diags: Diagnostic[] = [];

  // Build lookup structures
  const compoundMap = new Map<string, LoadedCompound>();
  for (const c of compounds) compoundMap.set(c.manifest.compound, c);

  // Map absolute file path -> { compound name, unit name, role }
  const fileIndex = new Map<string, { compound: string; unit: string; role: string }>();
  for (const c of compounds) {
    for (const u of c.manifest.units ?? []) {
      const abs = path.resolve(c.dir, u.file);
      fileIndex.set(abs, {
        compound: c.manifest.compound,
        unit: u.name,
        role: u.role,
      });
    }
  }

  // Implicit solvents — compounds whose type has implicit: true
  const implicitNames = new Set<string>();
  for (const c of compounds) {
    const typeDef = workspace.compound_types?.[c.manifest.type ?? "compound"];
    if (typeDef?.implicit) implicitNames.add(c.manifest.compound);
  }

  // Collect all unit file paths to analyze
  const filesToAnalyze: { abs: string; compound: LoadedCompound }[] = [];
  for (const c of compounds) {
    for (const u of c.manifest.units ?? []) {
      const abs = path.resolve(c.dir, u.file);
      filesToAnalyze.push({ abs, compound: c });
    }
  }

  if (filesToAnalyze.length === 0) return diags;

  // Batch-parse all imports via the language plugin
  const allFilePaths = filesToAnalyze.map((f) => f.abs);
  const batchResult = plugin.parseImportsBatch(allFilePaths);

  // Analyze each file's imports
  for (const { abs, compound: srcCompound } of filesToAnalyze) {
    const imports = batchResult.get(abs);
    if (!imports || imports.length === 0) continue;

    const srcInfo = fileIndex.get(abs);
    if (!srcInfo) continue;

    const srcRole = srcInfo.role;
    const allowedRoles = workspace.bonds[srcRole];

    for (const imp of imports) {
      // Resolve module specifier to absolute path via the plugin
      const resolvedPath = plugin.resolveModulePath(abs, imp.moduleSpecifier);

      // Skip external/stdlib modules (unresolvable)
      if (resolvedPath === undefined) continue;

      // Look up the resolved path in the file index
      const targetInfo = fileIndex.get(resolvedPath);

      // Not a known chem unit — skip
      if (!targetInfo) continue;

      const targetCompound = targetInfo.compound;
      const targetRole = targetInfo.role;
      const importedNames = imp.names.length > 0 ? imp.names.join(", ") : "(side-effect)";

      // --- Check 1: Bond rules ---
      if (allowedRoles && !allowedRoles.includes(targetRole)) {
        diags.push({
          level: "error",
          check: "import-bonds",
          code: "CHEM-BOND-003",
          compound: srcCompound.manifest.compound,
          message: tr("diagnostic.import_bond_violation", {
            file: path.basename(abs),
            src_role: srcRole,
            target_role: targetRole,
            names: importedNames,
          }),
          hint: `${srcRole} can only import from [${allowedRoles.join(", ")}]`,
        });
      }

      // --- Check 2: Cross-compound import rules ---
      if (targetCompound !== srcCompound.manifest.compound) {
        const crossRule = workspace.rules?.cross_compound_imports ?? "public_only";

        if (crossRule === "public_only") {
          const surfaceFile = workspace.rules?.public_surface ?? plugin.defaults.publicSurface;
          const targetC = compoundMap.get(targetCompound);

          if (targetC) {
            const surfaceAbs = path.resolve(targetC.dir, surfaceFile);

            // The resolved import should point to the public surface
            if (resolvedPath !== surfaceAbs) {
              // Check if the source compound declares the target as an import
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
                  message: tr("diagnostic.import_undeclared", {
                    file: path.basename(abs),
                    target: targetCompound,
                    src_compound: srcCompound.manifest.compound,
                  }),
                  hint: `Add "- compound: ${targetCompound}" to imports in ${srcCompound.manifest.compound}/compound.yaml`,
                });
              }

              diags.push({
                level: "error",
                check: "import-bypass",
                code: "CHEM-IMPORT-004",
                compound: srcCompound.manifest.compound,
                message: tr("diagnostic.import_bypass", {
                  file: path.basename(abs),
                  target: targetCompound,
                  surface: surfaceFile,
                }),
                hint: `Import from "${targetCompound}/${surfaceFile}" instead`,
              });
            }
          }
        }
      }
    }
  }

  return diags;
}
