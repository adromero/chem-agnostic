import * as fs from "node:fs";
import * as path from "node:path";
import type { Workspace, LoadedCompound, Diagnostic, CheckFn } from "./types.js";
import { tr } from "./vocabulary/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compoundType(c: LoadedCompound): string {
  return c.manifest.type ?? "compound";
}

function buildCompoundMap(compounds: LoadedCompound[]): Map<string, LoadedCompound> {
  const map = new Map<string, LoadedCompound>();
  for (const c of compounds) map.set(c.manifest.compound, c);
  return map;
}

/** Pluralise a role name the way exports keys are written (element -> elements) */
function pluralise(role: string): string {
  return `${role}s`;
}

/** Singularise an exports key back to a role (elements -> element) */
function singularise(key: string): string {
  return key.replace(/s$/, "");
}

/** Collect all exported unit names from a compound manifest. */
function allExportedNames(c: LoadedCompound): Set<string> {
  const names = new Set<string>();
  if (c.manifest.exports) {
    for (const list of Object.values(c.manifest.exports)) {
      for (const n of list) names.add(n);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Check 1 — No duplicate compound names
// ---------------------------------------------------------------------------
const checkNoDuplicates: CheckFn = (_ws, compounds) => {
  const diags: Diagnostic[] = [];
  const seen = new Map<string, string>();

  for (const c of compounds) {
    const name = c.manifest.compound;
    if (seen.has(name)) {
      diags.push({
        level: "error",
        check: "no-duplicates",
        compound: name,
        message: tr("diagnostic.duplicate_compound", { name }),
        hint: `Also defined in: ${seen.get(name)}`,
      });
    } else {
      seen.set(name, c.dir);
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 2 — Every unit uses a role defined in workspace.roles
// ---------------------------------------------------------------------------
const checkKnownRoles: CheckFn = (ws, compounds) => {
  const diags: Diagnostic[] = [];
  const known = new Set(Object.keys(ws.roles));

  for (const c of compounds) {
    for (const u of c.manifest.units ?? []) {
      if (!known.has(u.role)) {
        diags.push({
          level: "error",
          check: "known-roles",
          compound: c.manifest.compound,
          message: tr("diagnostic.unknown_role", { unit: u.name, role: u.role }),
          hint: `Known roles: [${[...known].join(", ")}]`,
        });
      }
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 3 — Declared files exist on disk
// ---------------------------------------------------------------------------
const checkFileExistence: CheckFn = (ws, compounds, opts) => {
  if (opts.manifestOnly) return [];
  const diags: Diagnostic[] = [];

  for (const c of compounds) {
    for (const u of c.manifest.units ?? []) {
      const abs = path.resolve(c.dir, u.file);
      if (!fs.existsSync(abs)) {
        diags.push({
          level: "error",
          check: "file-existence",
          compound: c.manifest.compound,
          message: tr("diagnostic.file_missing_unit", { unit: u.name, file: u.file }),
          hint: `Expected at ${abs}`,
        });
      }
    }
    for (const a of c.manifest.assays ?? []) {
      const abs = path.resolve(c.dir, a.file);
      if (!fs.existsSync(abs)) {
        diags.push({
          level: "error",
          check: "file-existence",
          compound: c.manifest.compound,
          message: tr("diagnostic.file_missing_assay", { assay: a.name, file: a.file }),
          hint: `Expected at ${abs}`,
        });
      }
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 4 — Public surface file exists for exporting compounds
// ---------------------------------------------------------------------------
const checkPublicSurface: CheckFn = (ws, compounds, opts) => {
  if (opts.manifestOnly) return [];
  if (ws.rules?.cross_compound_imports !== "public_only") return [];

  const surfaceFile = ws.rules?.public_surface ?? opts.defaultPublicSurface ?? "public.ts";
  const diags: Diagnostic[] = [];

  for (const c of compounds) {
    if (compoundType(c) === "catalyst") continue;
    if (!c.manifest.exports || Object.keys(c.manifest.exports).length === 0) continue;

    const abs = path.join(c.dir, surfaceFile);
    if (!fs.existsSync(abs)) {
      diags.push({
        level: "warning",
        check: "public-surface",
        compound: c.manifest.compound,
        message: tr("diagnostic.public_surface_missing", { surface: surfaceFile }),
        hint: `Create ${abs}`,
      });
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 5 — Units are in the correct role folder
// ---------------------------------------------------------------------------
const checkRoleFolders: CheckFn = (ws, compounds) => {
  if (ws.rules?.role_from_path === false) return [];

  const diags: Diagnostic[] = [];
  const folderOf = new Map<string, string>();
  for (const [role, def] of Object.entries(ws.roles)) {
    folderOf.set(role, def.folder);
  }

  for (const c of compounds) {
    for (const u of c.manifest.units ?? []) {
      const expected = folderOf.get(u.role);
      if (!expected) continue;

      const segments = u.file.replace(/\\/g, "/").split("/");
      if (!segments.includes(expected)) {
        diags.push({
          level: "error",
          check: "role-folders",
          compound: c.manifest.compound,
          message: tr("diagnostic.role_folder_mismatch", {
            unit: u.name,
            role: u.role,
            expected,
          }),
          hint: `File: ${u.file}`,
        });
      }
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 6 — Every export maps to a declared unit with the right role
// ---------------------------------------------------------------------------
const checkExportConsistency: CheckFn = (_ws, compounds) => {
  const diags: Diagnostic[] = [];

  for (const c of compounds) {
    if (!c.manifest.exports) continue;

    const unitsByRole = new Map<string, Set<string>>();
    for (const u of c.manifest.units ?? []) {
      if (!unitsByRole.has(u.role)) unitsByRole.set(u.role, new Set());
      unitsByRole.get(u.role)!.add(u.name);
    }

    for (const [key, names] of Object.entries(c.manifest.exports)) {
      const role = singularise(key);
      const unitsForRole = unitsByRole.get(role) ?? new Set<string>();

      for (const name of names) {
        if (!unitsForRole.has(name)) {
          diags.push({
            level: "error",
            check: "export-consistency",
            compound: c.manifest.compound,
            message: tr("diagnostic.export_no_unit", { name, key, role }),
            hint: `Add a unit { role: "${role}", name: "${name}", ... } to the units list`,
          });
        }
      }
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 7 — Imported compounds exist
// ---------------------------------------------------------------------------
const checkImportExistence: CheckFn = (_ws, compounds) => {
  const diags: Diagnostic[] = [];
  const names = new Set(compounds.map((c) => c.manifest.compound));

  for (const c of compounds) {
    for (const imp of c.manifest.imports ?? []) {
      if (!names.has(imp.compound)) {
        diags.push({
          level: "error",
          check: "import-existence",
          compound: c.manifest.compound,
          message: tr("diagnostic.import_existence", { compound: imp.compound }),
        });
      }
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 8 — Imported specific units are actually exported by target
// ---------------------------------------------------------------------------
const checkImportSpecificity: CheckFn = (_ws, compounds) => {
  const diags: Diagnostic[] = [];
  const map = buildCompoundMap(compounds);

  for (const c of compounds) {
    for (const imp of c.manifest.imports ?? []) {
      if (!imp.units) continue;
      const target = map.get(imp.compound);
      if (!target) continue;

      const exported = allExportedNames(target);
      for (const name of imp.units) {
        if (!exported.has(name)) {
          diags.push({
            level: "error",
            check: "import-specificity",
            compound: c.manifest.compound,
            message: tr("diagnostic.import_specificity", { name, compound: imp.compound }),
          });
        }
      }
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 9 — Compound type import rules
// ---------------------------------------------------------------------------
const checkCompoundTypeImports: CheckFn = (ws, compounds) => {
  const diags: Diagnostic[] = [];
  const map = buildCompoundMap(compounds);

  for (const c of compounds) {
    const selfType = compoundType(c);
    const selfDef = ws.compound_types?.[selfType];
    const allowed = selfDef?.can_import;

    for (const imp of c.manifest.imports ?? []) {
      const target = map.get(imp.compound);
      if (!target) continue;
      const targetType = compoundType(target);

      // Can this compound type import from that compound type?
      if (allowed && !allowed.includes(targetType)) {
        diags.push({
          level: "error",
          check: "compound-type-imports",
          compound: c.manifest.compound,
          message: tr("diagnostic.compound_type_cannot_import", {
            target: imp.compound,
            target_type: targetType,
            self_type: selfType,
            allowed: allowed.join(", "),
          }),
        });
      }

      // Is the target importable at all?
      const targetDef = ws.compound_types?.[targetType];
      if (targetDef?.importable_by === "none") {
        diags.push({
          level: "error",
          check: "compound-type-imports",
          compound: c.manifest.compound,
          message: tr("diagnostic.compound_type_target_uniport", {
            target: imp.compound,
            target_type: targetType,
          }),
        });
      } else if (targetDef?.importable_by === "same_type" && selfType !== targetType) {
        diags.push({
          level: "error",
          check: "compound-type-imports",
          compound: c.manifest.compound,
          message: tr("diagnostic.compound_type_target_same_type", {
            target: imp.compound,
            target_type: targetType,
          }),
        });
      }
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 10 — Bond rules (unit-level dependency validation)
// ---------------------------------------------------------------------------
const checkBondRules: CheckFn = (ws, compounds) => {
  const diags: Diagnostic[] = [];
  const map = buildCompoundMap(compounds);

  // Identify implicit compounds (solvents)
  const implicitCompounds = new Set<string>();
  for (const c of compounds) {
    const typeDef = ws.compound_types?.[compoundType(c)];
    if (typeDef?.implicit) implicitCompounds.add(c.manifest.compound);
  }

  for (const c of compounds) {
    // Local units: name -> role
    const localUnits = new Map<string, string>();
    for (const u of c.manifest.units ?? []) localUnits.set(u.name, u.role);

    // External units accessible via imports + implicit solvents
    const externalUnits = new Map<string, string>();
    const importedNames = new Set((c.manifest.imports ?? []).map((i) => i.compound));

    for (const other of compounds) {
      if (other.manifest.compound === c.manifest.compound) continue;
      const isImported = importedNames.has(other.manifest.compound);
      const isImplicit = implicitCompounds.has(other.manifest.compound);
      if (!isImported && !isImplicit) continue;

      // Only exported units are reachable
      if (other.manifest.exports) {
        for (const [key, names] of Object.entries(other.manifest.exports)) {
          const role = singularise(key);
          for (const name of names) externalUnits.set(name, role);
        }
      }
    }

    // Validate each depends_on entry
    for (const u of c.manifest.units ?? []) {
      const allowedRoles = ws.bonds[u.role];
      if (!allowedRoles) continue;

      for (const dep of u.depends_on ?? []) {
        const depRole: string | undefined = localUnits.get(dep) ?? externalUnits.get(dep);

        if (depRole === undefined) {
          diags.push({
            level: "error",
            check: "bond-rules",
            compound: c.manifest.compound,
            message: tr("diagnostic.bond_unresolved", { src_name: u.name, dep }),
            hint: "Not a local unit, not in declared imports, and not in an implicit solvent",
          });
          continue;
        }

        if (!allowedRoles.includes(depRole)) {
          diags.push({
            level: "error",
            check: "bond-rules",
            compound: c.manifest.compound,
            message: tr("diagnostic.bond_violation", {
              src_name: u.name,
              src_role: u.role,
              dep,
              dep_role: depRole,
            }),
            hint: `${u.role} may only depend on [${allowedRoles.join(", ")}]`,
          });
        }
      }
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 11 — Signal consistency
// ---------------------------------------------------------------------------
const checkSignalConsistency: CheckFn = (_ws, compounds) => {
  const diags: Diagnostic[] = [];
  const allEmitted = new Set<string>();

  for (const c of compounds) {
    const reactions = new Set(
      (c.manifest.units ?? []).filter((u) => u.role === "reaction").map((u) => u.name),
    );

    for (const em of c.manifest.signals?.emits ?? []) {
      allEmitted.add(em.signal);
      if (em.emitted_by && !reactions.has(em.emitted_by)) {
        diags.push({
          level: "error",
          check: "signal-consistency",
          compound: c.manifest.compound,
          message: tr("diagnostic.signal_emitter_not_reaction", {
            signal: em.signal,
            emitter: em.emitted_by,
          }),
        });
      }
    }

    for (const li of c.manifest.signals?.listens ?? []) {
      if (!reactions.has(li.handler)) {
        diags.push({
          level: "error",
          check: "signal-consistency",
          compound: c.manifest.compound,
          message: tr("diagnostic.signal_handler_not_reaction", {
            signal: li.signal,
            handler: li.handler,
          }),
        });
      }
    }
  }

  // Warn about orphaned listeners
  for (const c of compounds) {
    for (const li of c.manifest.signals?.listens ?? []) {
      if (!allEmitted.has(li.signal)) {
        diags.push({
          level: "warning",
          check: "signal-consistency",
          compound: c.manifest.compound,
          message: tr("diagnostic.signal_orphaned_listener", { signal: li.signal }),
          hint: "Emitting compound may not be loaded, or signal name is misspelled",
        });
      }
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 12 — Catalyst wiring validity
// ---------------------------------------------------------------------------
const checkWiringValidity: CheckFn = (_ws, compounds) => {
  const diags: Diagnostic[] = [];
  const map = buildCompoundMap(compounds);

  for (const c of compounds) {
    if (compoundType(c) !== "catalyst") continue;

    for (const w of c.manifest.wiring ?? []) {
      const target = map.get(w.compound);
      if (!target) {
        diags.push({
          level: "error",
          check: "wiring-validity",
          compound: c.manifest.compound,
          message: tr("diagnostic.wiring_compound_missing", { compound: w.compound }),
        });
        continue;
      }

      const units = target.manifest.units ?? [];
      const iface = units.find((u) => u.role === "interface" && u.name === w.interface);
      const adapter = units.find((u) => u.role === "adapter" && u.name === w.adapter);

      if (!iface) {
        diags.push({
          level: "error",
          check: "wiring-validity",
          compound: c.manifest.compound,
          message: tr("diagnostic.wiring_interface_missing", {
            iface: w.interface,
            compound: w.compound,
          }),
        });
      }

      if (!adapter) {
        diags.push({
          level: "error",
          check: "wiring-validity",
          compound: c.manifest.compound,
          message: tr("diagnostic.wiring_adapter_missing", {
            adapter: w.adapter,
            compound: w.compound,
          }),
        });
      }

      if (adapter && !(adapter.implements ?? []).includes(w.interface)) {
        diags.push({
          level: "error",
          check: "wiring-validity",
          compound: c.manifest.compound,
          message: tr("diagnostic.wiring_adapter_no_implements", {
            adapter: w.adapter,
            iface: w.interface,
            compound: w.compound,
          }),
          hint: `Add "${w.interface}" to the implements list of "${w.adapter}" in compound "${w.compound}"`,
        });
      }
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 13 — Singleton constraints
// ---------------------------------------------------------------------------
const checkSingletons: CheckFn = (ws, compounds) => {
  const diags: Diagnostic[] = [];
  const byType = new Map<string, string[]>();

  for (const c of compounds) {
    const t = compoundType(c);
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(c.manifest.compound);
  }

  for (const [type, names] of byType) {
    const def = ws.compound_types?.[type];
    if (def?.singleton && names.length > 1) {
      diags.push({
        level: "error",
        check: "singleton",
        message: tr("diagnostic.singleton_violated", {
          type,
          count: names.length,
          names: names.join(", "),
        }),
      });
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 14 — Role restrictions per compound type
// ---------------------------------------------------------------------------
const checkRoleRestrictions: CheckFn = (ws, compounds) => {
  const diags: Diagnostic[] = [];

  for (const c of compounds) {
    const def = ws.compound_types?.[compoundType(c)];
    const allowed = def?.allowed_roles;
    if (!allowed) continue;

    for (const u of c.manifest.units ?? []) {
      if (!allowed.includes(u.role)) {
        diags.push({
          level: "error",
          check: "role-restrictions",
          compound: c.manifest.compound,
          message: tr("diagnostic.role_not_allowed_for_type", {
            unit: u.name,
            role: u.role,
            type: compoundType(c),
            allowed: allowed.join(", "),
          }),
        });
      }
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Check 15 — Assay subjects and mocks reference real units
// ---------------------------------------------------------------------------
const checkAssayReferences: CheckFn = (_ws, compounds) => {
  const diags: Diagnostic[] = [];

  for (const c of compounds) {
    const unitNames = new Set((c.manifest.units ?? []).map((u) => u.name));
    const interfaces = new Set(
      (c.manifest.units ?? []).filter((u) => u.role === "interface").map((u) => u.name),
    );

    for (const a of c.manifest.assays ?? []) {
      for (const s of a.subjects ?? []) {
        if (!unitNames.has(s)) {
          diags.push({
            level: "warning",
            check: "assay-references",
            compound: c.manifest.compound,
            message: tr("diagnostic.assay_subject_unknown", { assay: a.name, subject: s }),
          });
        }
      }
      for (const m of a.mocks ?? []) {
        if (!interfaces.has(m) && !unitNames.has(m)) {
          diags.push({
            level: "warning",
            check: "assay-references",
            compound: c.manifest.compound,
            message: tr("diagnostic.assay_mock_not_interface", { assay: a.name, mock: m }),
            hint: "Mocks should reference interfaces",
          });
        }
      }
    }
  }
  return diags;
};

// ---------------------------------------------------------------------------
// Registry — ordered list of all checks
// ---------------------------------------------------------------------------
export const allChecks: { name: string; fn: CheckFn }[] = [
  { name: "No duplicate compounds", fn: checkNoDuplicates },
  { name: "Known roles", fn: checkKnownRoles },
  { name: "File existence", fn: checkFileExistence },
  { name: "Public surface", fn: checkPublicSurface },
  { name: "Role-folder alignment", fn: checkRoleFolders },
  { name: "Export consistency", fn: checkExportConsistency },
  { name: "Import existence", fn: checkImportExistence },
  { name: "Import specificity", fn: checkImportSpecificity },
  { name: "Compound type imports", fn: checkCompoundTypeImports },
  { name: "Bond rules", fn: checkBondRules },
  { name: "Signal consistency", fn: checkSignalConsistency },
  { name: "Wiring validity", fn: checkWiringValidity },
  { name: "Singleton constraints", fn: checkSingletons },
  { name: "Role restrictions", fn: checkRoleRestrictions },
  { name: "Assay references", fn: checkAssayReferences },
];
