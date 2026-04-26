// ---------------------------------------------------------------------------
// check-edit engine — single-file edit validation.
//
// Powers the `chemag check-edit` subcommand and (downstream) the editor
// hooks and MCP tools. Given a workspace, a file path, and optional new
// content, it:
//
//   1. Resolves the file's (compound, role) via the manifest first, then
//      explicit proposal flags, then the path-walking helper
//      `resolveFilePlacement` defined below.
//   2. Parses imports of the new content via the language plugin.
//   3. Runs bond + cross-compound rules scoped to that single file.
//   4. Runs the role-folder mismatch check scoped to the resolved unit.
//   5. Returns structured diagnostics + a populated `remediation` block
//      where a fix is mechanically derivable.
//
// All language-specific work is delegated to `LanguagePlugin`. The CLI
// layer wires the cache hooks (manifest cache, import cache) defined in
// wp-003; the engine itself is pure given its inputs.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LanguagePlugin } from "./plugin-interface.js";
import type {
  Diagnostic,
  DiagnosticRemediation,
  LoadedCompound,
  ParsedImport,
  Workspace,
} from "./types.js";
import { tr } from "./vocabulary/index.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ResolvedPlacement {
  compound: string;
  role: string;
}

/** Result of a single-file check-edit run. */
export interface CheckEditResult {
  /** Workspace-relative file path as provided by the caller (best-effort). */
  file: string;
  /** Resolved compound name, or null if the file is unplaceable. */
  compound: string | null;
  /** Resolved role name, or null if the file is unplaceable. */
  role: string | null;
  /** Diagnostics produced by the engine for this file. */
  diagnostics: CheckEditDiagnostic[];
}

/**
 * Per-diagnostic record emitted by check-edit. `file`, `line`, and `column`
 * are inherited from `Diagnostic` (added in wp-005); `imported_module` /
 * `imported_role` are check-edit specific extras for the JSON output.
 */
export interface CheckEditDiagnostic extends Diagnostic {
  /** Module specifier of the offending import, when applicable. */
  imported_module?: string;
  /** Resolved role of the imported target, when applicable. */
  imported_role?: string;
}

export interface RunCheckEditOptions {
  /** Resolved + cached parsed workspace.yaml. */
  workspace: Workspace;
  /** Absolute directory the workspace.yaml lives in. */
  workspaceDir: string;
  /** All compounds discovered (preferably via the manifest cache). */
  compounds: LoadedCompound[];
  /** Active language plugin. */
  plugin: LanguagePlugin;
  /** Absolute (or workspace-relative) path to the file under test. */
  filePath: string;
  /**
   * Hypothetical new content, e.g. read from stdin via `--content -`. When
   * provided, the engine writes it to a temp file before parsing imports —
   * the file on disk (if any) is left untouched.
   */
  content?: string;
  /** Caller-supplied role override (`--proposed-role`). */
  proposedRole?: string;
  /** Caller-supplied compound override (`--proposed-compound`). */
  proposedCompound?: string;
  /**
   * Optional cache hook for parsed imports (wp-003). The CLI passes a
   * function that consults the disk cache and falls back to the plugin.
   */
  parseImportsForFile?: (filePath: string, plugin: LanguagePlugin) => ParsedImport[];
}

// ---------------------------------------------------------------------------
// resolveFilePlacement
// ---------------------------------------------------------------------------

/**
 * Resolve a single file path to its (compound, role) within a workspace by
 * walking the configured compound roots and matching the file's parent
 * folder against the workspace's role-folder map. Returns `null` if the
 * file is not under any known compound root or its parent folder is not a
 * known role folder. Mirrors the directory walk performed by
 * `sync.ts::inferCompound`, but for a single file path.
 */
export function resolveFilePlacement(
  workspace: Workspace,
  workspaceDir: string,
  filePath: string,
  _plugin: LanguagePlugin,
): ResolvedPlacement | null {
  // Step 1 — absolute target path.
  const abs = path.resolve(workspaceDir, filePath);

  // Step 2 — compound roots (compounds, plus optional reagents/solvents/
  // catalyst). `catalyst` is a single compound directory rather than a
  // parent of compound subdirectories — for the purpose of placement
  // resolution we still treat its parent as the compound root so the
  // first segment under it is the catalyst's own folder name.
  const roots: { abs: string; allowsCompoundChildren: boolean }[] = [
    {
      abs: path.resolve(workspaceDir, workspace.paths.compounds),
      allowsCompoundChildren: true,
    },
  ];
  if (workspace.paths.reagents) {
    roots.push({
      abs: path.resolve(workspaceDir, workspace.paths.reagents),
      allowsCompoundChildren: true,
    });
  }
  if (workspace.paths.solvents) {
    roots.push({
      abs: path.resolve(workspaceDir, workspace.paths.solvents),
      allowsCompoundChildren: true,
    });
  }
  if (workspace.paths.catalyst) {
    // The catalyst is a single compound directory. Treat its PARENT as the
    // root so the first relative segment is the catalyst's folder name.
    const catalystAbs = path.resolve(workspaceDir, workspace.paths.catalyst);
    roots.push({ abs: path.dirname(catalystAbs), allowsCompoundChildren: true });
  }

  // Step 6 (precomputed) — folder → role map.
  const folderToRole = new Map<string, string>();
  for (const [role, def] of Object.entries(workspace.roles)) {
    folderToRole.set(def.folder, role);
  }

  for (const root of roots) {
    // Step 3 — candidate relative path under this root.
    const rel = path.relative(root.abs, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;

    // Step 4 — split into segments. Need at least <compound>/<roleFolder>/<file>.
    const segments = rel.split(path.sep);
    if (segments.length < 3) continue;

    const compoundSegment = segments[0];
    const roleFolderSegment = segments[1];

    // Step 5 — compound directory must exist (we don't require its
    // manifest to list this file — caller may be proposing a new file).
    const compoundDir = path.join(root.abs, compoundSegment);
    if (!fs.existsSync(compoundDir)) continue;
    if (!fs.statSync(compoundDir).isDirectory()) continue;

    // Step 6 — role folder must be known.
    const role = folderToRole.get(roleFolderSegment);
    if (!role) continue;

    // Step 7 — `plugin.isSourceFile(basename)` is consultative here. We
    // resolve regardless; downstream checks may flag non-source files.

    // Step 8 — return.
    return { compound: compoundSegment, role };
  }

  return null;
}

// ---------------------------------------------------------------------------
// runCheckEdit — engine entry point
// ---------------------------------------------------------------------------

/**
 * Run the full check-edit pipeline for a single file. Returns the result;
 * the CLI layer formats it for human or JSON output.
 */
export function runCheckEdit(opts: RunCheckEditOptions): CheckEditResult {
  const { workspace, workspaceDir, compounds, plugin, filePath, content } = opts;
  const absFilePath = path.resolve(workspaceDir, filePath);

  // Step 1 — placement resolution precedence:
  //   (a) existing manifest unit, (b) explicit proposal, (c) path inference.
  const placement = resolvePlacement(opts, absFilePath);

  if (placement === null) {
    // Step 2 — unresolvable. Single diagnostic, stop.
    const diag: CheckEditDiagnostic = {
      level: "error",
      check: "unresolvable-placement",
      code: "CHEM-PLACEMENT-004",
      message: tr("diagnostic.unresolvable_placement", { file: filePath }),
      hint:
        "Provide --proposed-role and --proposed-compound, or place the file under " +
        "<compounds>/<name>/<role-folder>/.",
      file: absFilePath,
    };
    return {
      file: filePath,
      compound: null,
      role: null,
      diagnostics: [diag],
    };
  }

  const { compound: srcCompoundName, role: srcRole } = placement;
  const srcCompound = compounds.find((c) => c.manifest.compound === srcCompoundName);

  // Step 3 — parse imports of the (hypothetical) file content.
  const imports = parseImports(opts, absFilePath, content);

  // Step 4 — diagnostics.
  const diagnostics: CheckEditDiagnostic[] = [];

  // 4a. Role-folder mismatch (mirrors the manifest-level check from checks.ts).
  const expectedFolder = workspace.roles[srcRole]?.folder;
  if (expectedFolder !== undefined && workspace.rules?.role_from_path !== false) {
    const segments = path.relative(workspaceDir, absFilePath).split(path.sep);
    if (!segments.includes(expectedFolder)) {
      diagnostics.push({
        level: "error",
        check: "role-folders",
        code: "CHEM-PLACEMENT-003",
        compound: srcCompoundName,
        message: tr("diagnostic.role_folder_mismatch", {
          unit: path.basename(absFilePath, path.extname(absFilePath)),
          role: srcRole,
          expected: expectedFolder,
        }),
        hint: `File: ${filePath}`,
        remediation: { kind: "move_to_role_folder", expected_folder: expectedFolder },
        file: absFilePath,
      });
    }
  }

  // 4b. Bond rules + cross-compound rules — reuses the per-import logic
  // from `import-check.ts`, scoped to a single source file.
  if (srcCompound) {
    diagnostics.push(...checkSingleFileImports(opts, absFilePath, srcCompound, srcRole, imports));
  }

  return {
    file: filePath,
    compound: srcCompoundName,
    role: srcRole,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Internal: placement resolution precedence
// ---------------------------------------------------------------------------

function resolvePlacement(
  opts: RunCheckEditOptions,
  absFilePath: string,
): ResolvedPlacement | null {
  const { workspace, workspaceDir, compounds, plugin, proposedRole, proposedCompound } = opts;

  // (a) Existing manifest entry.
  for (const c of compounds) {
    for (const u of c.manifest.units ?? []) {
      const unitAbs = path.resolve(c.dir, u.file);
      if (unitAbs === absFilePath) {
        return { compound: c.manifest.compound, role: u.role };
      }
    }
  }

  // (b) Explicit proposal — both flags must be present.
  if (proposedRole !== undefined && proposedCompound !== undefined) {
    return { compound: proposedCompound, role: proposedRole };
  }

  // (c) Path inference.
  return resolveFilePlacement(workspace, workspaceDir, absFilePath, plugin);
}

// ---------------------------------------------------------------------------
// Internal: parse imports (handles `--content` by writing to a temp file)
// ---------------------------------------------------------------------------

function parseImports(
  opts: RunCheckEditOptions,
  absFilePath: string,
  content: string | undefined,
): ParsedImport[] {
  const { plugin, parseImportsForFile } = opts;

  if (content === undefined) {
    // No override — read the file on disk via the cache-aware hook (or the
    // plugin directly if no hook was supplied).
    if (parseImportsForFile) return parseImportsForFile(absFilePath, plugin);
    return plugin.parseImports(absFilePath);
  }

  // Override path. We materialise the content in a sibling temp file with
  // the same extension so the plugin's import resolver and any extension-
  // aware logic works as if the content were on disk. We pick the directory
  // of the target file so relative-import resolution against neighbours
  // still works correctly.
  const ext = path.extname(absFilePath) || plugin.fileExtensions[0] || "";
  const dir = path.dirname(absFilePath);
  const dirToUse = fs.existsSync(dir) ? dir : os.tmpdir();
  const tmp = path.join(
    dirToUse,
    `.chemag-edit-${process.pid}-${Math.random().toString(36).slice(2, 10)}${ext}`,
  );
  try {
    fs.writeFileSync(tmp, content, "utf-8");
    return plugin.parseImports(tmp);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: single-file import checks (bond + cross-compound)
//
// This is the moral equivalent of the per-file portion of
// `checkImports` in import-check.ts — kept separate because:
//   - it can attribute imports against a synthetic source file (for the
//     `--content` path), even when that file isn't in any manifest yet,
//   - it produces the structured `remediation` block,
//   - it returns line numbers from the parsed imports.
// ---------------------------------------------------------------------------

function checkSingleFileImports(
  opts: RunCheckEditOptions,
  absFilePath: string,
  srcCompound: LoadedCompound,
  srcRole: string,
  imports: ParsedImport[],
): CheckEditDiagnostic[] {
  const { workspace, plugin, compounds } = opts;
  const diags: CheckEditDiagnostic[] = [];

  const allowedRoles = workspace.bonds[srcRole];

  // Build the file index once.
  const fileIndex = new Map<string, { compound: string; unit: string; role: string }>();
  for (const c of compounds) {
    for (const u of c.manifest.units ?? []) {
      fileIndex.set(path.resolve(c.dir, u.file), {
        compound: c.manifest.compound,
        unit: u.name,
        role: u.role,
      });
    }
  }

  // Implicit solvents.
  const implicitNames = new Set<string>();
  for (const c of compounds) {
    const td = workspace.compound_types?.[c.manifest.type ?? "compound"];
    if (td?.implicit) implicitNames.add(c.manifest.compound);
  }

  const compoundMap = new Map<string, LoadedCompound>();
  for (const c of compounds) compoundMap.set(c.manifest.compound, c);

  for (const imp of imports) {
    const resolvedPath = plugin.resolveModulePath(absFilePath, imp.moduleSpecifier);
    if (resolvedPath === undefined) continue; // external / stdlib

    const targetInfo = fileIndex.get(resolvedPath);
    if (!targetInfo) continue;

    const targetCompound = targetInfo.compound;
    const targetRole = targetInfo.role;
    const importedNames = imp.names.length > 0 ? imp.names.join(", ") : "(side-effect)";

    // --- Bond rules ---
    if (allowedRoles && !allowedRoles.includes(targetRole)) {
      const code =
        targetCompound === srcCompound.manifest.compound ? "CHEM-BOND-002" : "CHEM-BOND-003";
      const remediation: DiagnosticRemediation | undefined =
        targetRole === "adapter"
          ? {
              kind: "use_interface",
              interface_candidates: collectInterfaceCandidates(
                compoundMap.get(targetCompound),
                targetInfo.unit,
              ),
            }
          : undefined;

      diags.push({
        level: "error",
        check: code === "CHEM-BOND-002" ? "bond-rules" : "import-bonds",
        code,
        compound: srcCompound.manifest.compound,
        message: tr("diagnostic.import_bond_violation", {
          file: path.basename(absFilePath),
          src_role: srcRole,
          target_role: targetRole,
          names: importedNames,
        }),
        hint: `${srcRole} can only import from [${allowedRoles.join(", ")}]`,
        imported_module: imp.moduleSpecifier,
        imported_role: targetRole,
        file: absFilePath,
        ...(remediation ? { remediation } : {}),
      });
    }

    // --- Cross-compound rules ---
    if (targetCompound !== srcCompound.manifest.compound) {
      const crossRule = workspace.rules?.cross_compound_imports ?? "public_only";

      if (crossRule === "public_only") {
        const surfaceFile = workspace.rules?.public_surface ?? plugin.defaults.publicSurface;
        const targetC = compoundMap.get(targetCompound);

        if (targetC) {
          const surfaceAbs = path.resolve(targetC.dir, surfaceFile);

          if (resolvedPath !== surfaceAbs) {
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
                  file: path.basename(absFilePath),
                  target: targetCompound,
                  src_compound: srcCompound.manifest.compound,
                }),
                hint: `Add "- compound: ${targetCompound}" to imports in ${srcCompound.manifest.compound}/compound.yaml`,
                imported_module: imp.moduleSpecifier,
                imported_role: targetRole,
                file: absFilePath,
                remediation: { kind: "add_compound_import", target_compound: targetCompound },
              });
            }

            diags.push({
              level: "error",
              check: "import-bypass",
              code: "CHEM-IMPORT-004",
              compound: srcCompound.manifest.compound,
              message: tr("diagnostic.import_bypass", {
                file: path.basename(absFilePath),
                target: targetCompound,
                surface: surfaceFile,
              }),
              hint: `Import from "${targetCompound}/${surfaceFile}" instead`,
              imported_module: imp.moduleSpecifier,
              imported_role: targetRole,
              file: absFilePath,
              remediation: {
                kind: "import_via_public_surface",
                surface: surfaceFile,
                target_compound: targetCompound,
              },
            });
          }
        }
      }
    }
  }

  return diags;
}

/**
 * Best-effort list of interface candidates for an adapter target. When the
 * adapter's manifest declares `implements`, those interface names are the
 * preferred fix. Empty array means "no obvious candidate" — the caller
 * still emits the `use_interface` remediation, but with an empty list.
 */
function collectInterfaceCandidates(
  targetCompound: LoadedCompound | undefined,
  adapterName: string,
): string[] {
  if (!targetCompound) return [];
  const adapter = (targetCompound.manifest.units ?? []).find(
    (u) => u.role === "adapter" && u.name === adapterName,
  );
  return adapter?.implements ?? [];
}
