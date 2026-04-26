import * as fs from "node:fs";
import * as path from "node:path";
import { stringify } from "yaml";
import type { Workspace, Compound } from "./types.js";
import type { LanguagePlugin } from "./plugin-interface.js";

export interface SyncResult {
  created: string[];
  skipped: string[];
}

export function syncWorkspace(
  workspace: Workspace,
  workspaceDir: string,
  plugin: LanguagePlugin,
  dryRun: boolean,
): SyncResult {
  const created: string[] = [];
  const skipped: string[] = [];
  const manifestFilename = workspace.rules?.manifest_filename ?? "compound.yaml";

  // Directories to scan: [dir, compoundType]
  const scanDirs: [string, string][] = [
    [path.resolve(workspaceDir, workspace.paths.compounds), "compound"],
  ];
  if (workspace.paths.reagents) {
    scanDirs.push([path.resolve(workspaceDir, workspace.paths.reagents), "reagent"]);
  }
  if (workspace.paths.solvents) {
    scanDirs.push([path.resolve(workspaceDir, workspace.paths.solvents), "solvent"]);
  }

  for (const [baseDir, compoundType] of scanDirs) {
    if (!fs.existsSync(baseDir)) continue;

    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const compoundDir = path.join(baseDir, entry.name);
      const manifestPath = path.join(compoundDir, manifestFilename);

      if (fs.existsSync(manifestPath)) {
        skipped.push(manifestPath);
        continue;
      }

      // No manifest — infer one from the directory contents
      const manifest = inferCompound(entry.name, compoundType, compoundDir, workspace, plugin);

      if (manifest.units && manifest.units.length > 0) {
        if (!dryRun) {
          fs.writeFileSync(manifestPath, stringify(manifest, { lineWidth: 100 }), "utf-8");
        }
        created.push(manifestPath);
      }
    }
  }

  return { created, skipped };
}

function inferCompound(
  name: string,
  type: string,
  dir: string,
  workspace: Workspace,
  plugin: LanguagePlugin,
): Compound {
  const units: NonNullable<Compound["units"]> = [];
  const exportNames: Record<string, string[]> = {};

  // Build reverse map: folder name -> role
  const folderToRole = new Map<string, string>();
  for (const [role, def] of Object.entries(workspace.roles)) {
    folderToRole.set(def.folder, role);
  }

  // Scan subdirectories matching known role folders
  for (const [folder, role] of folderToRole) {
    const roleDir = path.join(dir, folder);
    if (!fs.existsSync(roleDir)) continue;

    // Use plugin.isSourceFile to filter source files (language-aware)
    const files = fs.readdirSync(roleDir).filter((f) => plugin.isSourceFile(f));

    for (const file of files) {
      // Strip the first matching extension to get the unit name
      let unitName = file;
      for (const ext of plugin.fileExtensions) {
        if (file.endsWith(ext)) {
          unitName = file.slice(0, -ext.length);
          break;
        }
      }
      const filePath = `./${folder}/${file}`;

      const unit: NonNullable<Compound["units"]>[number] = {
        role,
        name: unitName,
        file: filePath,
      };

      // For adapters, try to infer implements from class declaration
      if (role === "adapter") {
        const impl = plugin.inferImplements(path.join(roleDir, file));
        if (impl.length > 0) unit.implements = impl;
      }

      units.push(unit);

      // Add to exports (everything except adapters)
      if (role !== "adapter") {
        const plural = `${role}s`;
        if (!exportNames[plural]) exportNames[plural] = [];
        exportNames[plural].push(unitName);
      }
    }
  }

  // Scan for assays — use plugin.defaults.testFilePattern
  const assays: NonNullable<Compound["assays"]> = [];
  const assayDir = path.join(dir, "assays");
  if (fs.existsSync(assayDir)) {
    const files = fs.readdirSync(assayDir).filter((f) => plugin.defaults.testFilePattern.test(f));
    for (const file of files) {
      // Strip extension for assay name
      let assayName = file;
      for (const ext of plugin.fileExtensions) {
        if (file.endsWith(ext)) {
          assayName = file.slice(0, -ext.length);
          break;
        }
      }
      assays.push({
        name: assayName,
        file: `./assays/${file}`,
      });
    }
  }

  const manifest: Compound = {
    compound: name,
    ...(type !== "compound" ? { type: type as Compound["type"] } : {}),
    description: "",
    exports: Object.keys(exportNames).length > 0 ? exportNames : undefined,
    imports: [],
    units,
    ...(assays.length > 0 ? { assays } : {}),
  };

  return manifest;
}
