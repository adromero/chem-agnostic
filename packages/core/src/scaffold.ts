import * as fs from "node:fs";
import * as path from "node:path";
import type {
  Workspace,
  LoadedCompound,
  UnitDeclaration,
  ResolvedImport,
} from "./types.js";
import type { LanguagePlugin } from "./plugin-interface.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
}

export function scaffoldWorkspace(
  workspace: Workspace,
  compounds: LoadedCompound[],
  plugin: LanguagePlugin,
  dryRun: boolean,
): ScaffoldResult {
  const created: string[] = [];
  const skipped: string[] = [];

  const compoundMap = new Map<string, LoadedCompound>();
  for (const c of compounds) compoundMap.set(c.manifest.compound, c);

  // Identify implicit solvents
  const implicitNames = new Set<string>();
  for (const c of compounds) {
    const typeDef =
      workspace.compound_types?.[c.manifest.type ?? "compound"];
    if (typeDef?.implicit) implicitNames.add(c.manifest.compound);
  }

  for (const c of compounds) {
    // Skip catalyst — it gets a hand-written entry point, not stubs
    if ((c.manifest.type ?? "compound") === "catalyst") continue;

    // Units
    for (const unit of c.manifest.units ?? []) {
      const abs = path.resolve(c.dir, unit.file);
      if (fs.existsSync(abs)) {
        skipped.push(abs);
        continue;
      }

      const imports = resolveImports(
        unit,
        c,
        compoundMap,
        implicitNames,
        workspace,
        plugin,
      );
      const content = plugin.generateUnitStub(unit, imports);
      writeFile(abs, content, dryRun);
      created.push(abs);
    }

    // Public surface
    const surface =
      workspace.rules?.public_surface ?? plugin.defaults.publicSurface;
    const surfacePath = path.resolve(c.dir, surface);
    if (
      c.manifest.exports &&
      Object.keys(c.manifest.exports).length > 0 &&
      !fs.existsSync(surfacePath)
    ) {
      const content = plugin.generatePublicSurface(c, workspace);
      writeFile(surfacePath, content, dryRun);
      created.push(surfacePath);
    } else if (fs.existsSync(surfacePath)) {
      skipped.push(surfacePath);
    }

    // Assays
    for (const assay of c.manifest.assays ?? []) {
      const abs = path.resolve(c.dir, assay.file);
      if (fs.existsSync(abs)) {
        skipped.push(abs);
        continue;
      }

      const content = plugin.generateAssayStub(assay, c);
      writeFile(abs, content, dryRun);
      created.push(abs);
    }
  }

  return { created, skipped };
}

// ---------------------------------------------------------------------------
// Import resolution (core — language-agnostic)
// ---------------------------------------------------------------------------

/**
 * Walk the dependency graph for a unit and resolve its imports to
 * ResolvedImport[], which the plugin can then render into actual
 * import statements.
 */
export function resolveImports(
  unit: UnitDeclaration,
  compound: LoadedCompound,
  compoundMap: Map<string, LoadedCompound>,
  implicitNames: Set<string>,
  workspace: Workspace,
  plugin: LanguagePlugin,
): ResolvedImport[] {
  const unitAbs = path.resolve(compound.dir, unit.file);
  const unitDir = path.dirname(unitAbs);

  // Local unit lookup
  const localUnits = new Map<string, UnitDeclaration>();
  for (const u of compound.manifest.units ?? []) {
    localUnits.set(u.name, u);
  }

  // Compound names reachable via imports + implicit solvents
  const reachable = new Set<string>([
    ...(compound.manifest.imports ?? []).map((i) => i.compound),
    ...implicitNames,
  ]);

  const deps = [...(unit.depends_on ?? []), ...(unit.implements ?? [])];
  const seen = new Set<string>();
  const imports: ResolvedImport[] = [];

  for (const depName of deps) {
    if (seen.has(depName)) continue;
    seen.add(depName);

    // Local?
    const local = localUnits.get(depName);
    if (local && local.name !== unit.name) {
      const depAbs = path.resolve(compound.dir, local.file);
      const rel = plugin.formatRelativeImport(unitDir, depAbs);
      imports.push({
        fromCompound: rel,
        fromUnit: depName,
        names: [depName],
        isTypeOnly: local.role === "interface",
      });
      continue;
    }

    // Cross-compound?
    for (const cName of reachable) {
      const target = compoundMap.get(cName);
      if (!target) continue;

      const exported = allExportedNames(target);
      if (!exported.has(depName)) continue;

      const surface =
        workspace.rules?.public_surface ?? plugin.defaults.publicSurface;
      const surfaceAbs = path.resolve(target.dir, surface);
      const rel = plugin.formatRelativeImport(unitDir, surfaceAbs);

      const depUnit = (target.manifest.units ?? []).find(
        (u) => u.name === depName,
      );
      imports.push({
        fromCompound: rel,
        fromUnit: depName,
        names: [depName],
        isTypeOnly: depUnit?.role === "interface",
      });
      break;
    }
  }

  // Merge imports from the same path
  return mergeImports(imports);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeImports(imports: ResolvedImport[]): ResolvedImport[] {
  const byPath = new Map<
    string,
    { names: Set<string>; isTypeOnly: boolean; fromUnit: string }
  >();

  for (const imp of imports) {
    const existing = byPath.get(imp.fromCompound);
    if (existing) {
      for (const n of imp.names) existing.names.add(n);
      // If any import from this path is value-level, keep it value-level
      if (!imp.isTypeOnly) existing.isTypeOnly = false;
    } else {
      byPath.set(imp.fromCompound, {
        names: new Set(imp.names),
        isTypeOnly: imp.isTypeOnly,
        fromUnit: imp.fromUnit,
      });
    }
  }

  return [...byPath.entries()].map(([fromCompound, { names, isTypeOnly, fromUnit }]) => ({
    fromCompound,
    fromUnit,
    names: [...names],
    isTypeOnly,
  }));
}

function allExportedNames(c: LoadedCompound): Set<string> {
  const names = new Set<string>();
  if (c.manifest.exports) {
    for (const list of Object.values(c.manifest.exports)) {
      for (const n of list) names.add(n);
    }
  }
  return names;
}

function writeFile(absPath: string, content: string, dryRun: boolean): void {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
}
