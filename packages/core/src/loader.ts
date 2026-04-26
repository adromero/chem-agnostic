import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Workspace, LoadedCompound, Compound } from "./types.js";

export function loadWorkspace(workspacePath: string): Workspace {
  const content = fs.readFileSync(workspacePath, "utf-8");
  const ws = parseYaml(content) as Workspace;

  if (!ws.workspace) {
    throw new Error(`Missing "workspace" field in ${workspacePath}`);
  }
  if (!ws.roles || Object.keys(ws.roles).length === 0) {
    throw new Error(`Missing or empty "roles" field in ${workspacePath}`);
  }
  if (!ws.bonds) {
    throw new Error(`Missing "bonds" field in ${workspacePath}`);
  }
  if (!ws.paths?.compounds) {
    throw new Error(`Missing "paths.compounds" field in ${workspacePath}`);
  }

  return ws;
}

export function discoverCompounds(
  workspace: Workspace,
  workspaceDir: string,
): LoadedCompound[] {
  const manifestFilename =
    workspace.rules?.manifest_filename ?? "compound.yaml";
  const compounds: LoadedCompound[] = [];

  // Standard compound directories (each subdirectory is a compound)
  const scanDirs: string[] = [workspace.paths.compounds];
  if (workspace.paths.reagents) scanDirs.push(workspace.paths.reagents);
  if (workspace.paths.solvents) scanDirs.push(workspace.paths.solvents);

  for (const rel of scanDirs) {
    const absDir = path.resolve(workspaceDir, rel);
    if (!fs.existsSync(absDir)) continue;

    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(absDir, entry.name, manifestFilename);
      if (fs.existsSync(manifestPath)) {
        compounds.push(loadCompound(manifestPath));
      }
    }
  }

  // Catalyst is a single directory, not a parent of compound subdirectories
  if (workspace.paths.catalyst) {
    const catalystDir = path.resolve(workspaceDir, workspace.paths.catalyst);
    const manifestPath = path.join(catalystDir, manifestFilename);
    if (fs.existsSync(manifestPath)) {
      compounds.push(loadCompound(manifestPath));
    }
  }

  return compounds;
}

function loadCompound(manifestPath: string): LoadedCompound {
  const content = fs.readFileSync(manifestPath, "utf-8");
  const manifest = parseYaml(content) as Compound;

  if (!manifest.compound) {
    throw new Error(`Missing "compound" field in ${manifestPath}`);
  }

  return { manifest, dir: path.dirname(manifestPath) };
}
