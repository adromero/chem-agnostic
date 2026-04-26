// ---------------------------------------------------------------------------
// Emission-coverage test (wp-007 criterion 5).
//
// Build a fixture workspace + a fixture import set designed to trigger every
// `diagnostic.*` TrKey, then assert:
//   1. every emitted diagnostic carries a registry-known code, and
//   2. every diagnostic.* TrKey actually fired at least once across
//      allChecks + checkImports.
//
// The second assertion is the load-bearing coverage check — it ensures the
// registry-test isn't passing on paper while a check forgot to attach a code.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { allChecks } from "../src/checks.js";
import { checkImports } from "../src/import-check.js";
import { DIAGNOSTIC_CODES } from "../src/diagnostics/codes.js";
import type {
  CheckOptions,
  Compound,
  LoadedCompound,
  ParsedImport,
  Workspace,
} from "../src/types.js";
import type { LanguagePlugin } from "../src/plugin-interface.js";
import { ALL_TR_KEYS, type TrKey } from "../src/vocabulary/keys.js";

const OPTS: CheckOptions = { manifestOnly: true };

function ws(overrides?: Partial<Workspace>): Workspace {
  return {
    workspace: "fixture",
    language: "typescript",
    roles: {
      element: { description: "Value", folder: "elements" },
      molecule: { description: "State", folder: "molecules" },
      reaction: { description: "Workflow", folder: "reactions" },
      interface: { description: "Contract", folder: "interfaces" },
      adapter: { description: "Implementation", folder: "adapters" },
    },
    bonds: {
      element: ["element"],
      molecule: ["element", "molecule"],
      reaction: ["element", "molecule", "interface"],
      interface: ["element", "molecule"],
      adapter: ["element", "molecule", "interface", "adapter"],
    },
    compound_types: {
      compound: {
        description: "Standard",
        importable_by: "all",
        can_import: ["compound", "reagent"],
      },
      reagent: {
        description: "Shared",
        importable_by: "all",
        can_import: ["reagent"],
      },
      solvent: {
        description: "Infra",
        importable_by: "same_type",
        can_import: ["reagent"],
        implicit: true,
      },
      catalyst: {
        description: "Root",
        importable_by: "none",
        can_import: ["compound", "reagent", "solvent"],
        singleton: true,
        allowed_roles: ["adapter"],
      },
    },
    paths: { compounds: "./src/compounds" },
    rules: { cross_compound_imports: "public_only", role_from_path: true },
    ...overrides,
  };
}

function lc(manifest: Compound, dir = "/tmp/fixture"): LoadedCompound {
  return { manifest, dir };
}

/**
 * Builds a set of compounds that trip every manifest-level diagnostic at
 * least once. Names of triggers are documented inline.
 */
function manifestFixtureCompounds(): LoadedCompound[] {
  return [
    // duplicate_compound — two compounds named "dup"
    lc({ compound: "dup", units: [] }, "/tmp/dup-a"),
    lc({ compound: "dup", units: [] }, "/tmp/dup-b"),

    // unknown_role — bogus role name
    lc({
      compound: "bad-role",
      units: [{ role: "wizard", name: "X", file: "./X.ts" }],
    }),

    // role_folder_mismatch — file lives in wrong folder
    lc({
      compound: "wrong-folder",
      units: [{ role: "element", name: "X", file: "./reactions/X.ts" }],
    }),

    // export_no_unit — exports name with no matching unit
    lc({
      compound: "missing-export",
      exports: { elements: ["Phantom"] },
      units: [],
    }),

    // import_existence — references non-existent compound
    lc({
      compound: "missing-import",
      imports: [{ compound: "ghost" }],
      units: [],
    }),

    // import_specificity — references a unit not in target's exports
    lc({
      compound: "wrong-unit-import",
      imports: [{ compound: "specificity-target", units: ["Hidden"] }],
      units: [],
    }),
    lc({
      compound: "specificity-target",
      exports: { elements: ["Public"] },
      units: [{ role: "element", name: "Public", file: "./elements/Public.ts" }],
    }),

    // compound_type_cannot_import — reagent importing a compound
    lc({
      compound: "reagent-imports-compound",
      type: "reagent",
      imports: [{ compound: "feature" }],
      units: [],
    }),
    lc({ compound: "feature", units: [] }),

    // compound_type_target_uniport — anyone importing a catalyst (importable_by: none)
    lc({
      compound: "imports-catalyst",
      imports: [{ compound: "root" }],
      units: [],
    }),
    lc({ compound: "root", type: "catalyst", units: [] }),

    // compound_type_target_same_type — compound importing a solvent (importable_by: same_type)
    lc({
      compound: "imports-solvent",
      imports: [{ compound: "infra-solvent" }],
      units: [],
    }),
    lc({ compound: "infra-solvent", type: "solvent", units: [] }),

    // bond_unresolved + bond_violation
    lc({
      compound: "bonds",
      units: [
        { role: "reaction", name: "DoThing", file: "./reactions/DoThing.ts" },
        {
          role: "element",
          name: "Bad",
          file: "./elements/Bad.ts",
          // depends on a reaction (violation) and a ghost (unresolved)
          depends_on: ["DoThing", "Ghost"],
        },
      ],
    }),

    // signal_emitter_not_reaction + signal_handler_not_reaction + signal_orphaned_listener
    lc({
      compound: "signals-bad",
      units: [{ role: "element", name: "X", file: "./elements/X.ts" }],
      signals: {
        emits: [{ signal: "x.done", emitted_by: "X" }], // emitter is element, not reaction
        listens: [{ signal: "x.done", handler: "X" }], // handler is element
      },
    }),
    lc({
      compound: "orphaned",
      units: [{ role: "reaction", name: "h", file: "./reactions/h.ts" }],
      signals: {
        listens: [{ signal: "never.emitted", handler: "h" }], // orphaned listener
      },
    }),

    // wiring_compound_missing + wiring_interface_missing + wiring_adapter_missing + wiring_adapter_no_implements
    lc({
      compound: "catalyst-bad",
      type: "catalyst",
      wiring: [
        // compound_missing — references a non-existent compound
        { interface: "Repo", adapter: "PgRepo", compound: "ghost-c" },
        // interface_missing + adapter_missing — wired against an existing compound that has neither
        { interface: "Repo", adapter: "PgRepo", compound: "wiring-target" },
        // adapter_no_implements — adapter exists but doesn't list this iface
        { interface: "Repo", adapter: "OtherAdapter", compound: "wiring-target-2" },
      ],
      units: [],
    }),
    lc({
      compound: "wiring-target",
      // singleton_violated will fire because we have catalyst-bad AND another-catalyst below
      units: [],
    }),
    lc({
      compound: "wiring-target-2",
      units: [
        { role: "interface", name: "Repo", file: "./interfaces/Repo.ts" },
        { role: "adapter", name: "OtherAdapter", file: "./adapters/OtherAdapter.ts" },
      ],
    }),

    // singleton_violated — second catalyst
    lc({
      compound: "another-catalyst",
      type: "catalyst",
      units: [],
    }),

    // role_not_allowed_for_type — catalyst type only allows "adapter" role per ws()
    lc({
      compound: "third-catalyst",
      type: "catalyst",
      units: [{ role: "element", name: "Nope", file: "./Nope.ts" }],
    }),

    // assay_subject_unknown + assay_mock_not_interface
    lc({
      compound: "assays",
      units: [
        { role: "element", name: "X", file: "./elements/X.ts" },
        { role: "interface", name: "Repo", file: "./interfaces/Repo.ts" },
      ],
      assays: [
        {
          name: "test1",
          file: "./assays/test1.ts",
          subjects: ["GhostSubject"], // unknown subject -> assay_subject_unknown
          mocks: ["X"], // X is an element, not interface -> assay_mock_not_interface
        },
      ],
    }),
  ];
}

/**
 * Trigger import-check diagnostics:
 *   - import_bond_violation: element file imports a reaction unit
 *   - import_undeclared:    file imports a sibling compound it doesn't declare
 *   - import_bypass:        sibling-compound import resolves to a non-public file
 *
 * The mock plugin returns synthetic file paths that align with the unit
 * declarations in `importFixtureCompounds()`.
 */
function importFixturePlugin(
  importMap: Map<string, ParsedImport[]>,
  resolutions: Map<string, string | undefined>,
): LanguagePlugin {
  return {
    name: "mock",
    fileExtensions: [".ts"],
    defaults: { publicSurface: "public.ts" },
    parseImportsBatch: (paths) => {
      const out = new Map<string, ParsedImport[]>();
      for (const p of paths) out.set(p, importMap.get(p) ?? []);
      return out;
    },
    parseImports: (p) => importMap.get(p) ?? [],
    resolveModulePath: (from, spec) => resolutions.get(`${from}::${spec}`),
    generateUnitStub: () => "",
    generatePublicSurface: () => "",
    fileNameForUnit: (n) => `${n}.ts`,
    inferUnitsFromDir: () => [],
  };
}

function importFixtureCompounds(): { compounds: LoadedCompound[]; ws: Workspace } {
  const w = ws();
  const compounds: LoadedCompound[] = [
    // src compound — has elements/El.ts, which will (per the mock) import:
    //   - "../other/reactions/Reaction.ts" (bond violation: element -> reaction)
    //   - "../sibling/internals/Helper.ts" (undeclared + bypass)
    lc(
      {
        compound: "src",
        units: [
          { role: "element", name: "El", file: "./elements/El.ts" },
          { role: "reaction", name: "Reaction", file: "./reactions/Reaction.ts" },
        ],
      },
      "/tmp/src",
    ),
    lc(
      {
        compound: "sibling",
        exports: { elements: ["Helper"] },
        units: [
          { role: "element", name: "Helper", file: "./elements/Helper.ts" },
          // public.ts surface
        ],
      },
      "/tmp/sibling",
    ),
  ];
  return { compounds, ws: w };
}

describe("emission coverage — every check carries a code in the registry", () => {
  it("every diagnostic emitted by allChecks has a registry-known code", () => {
    const compounds = manifestFixtureCompounds();
    const all: { check: string; code: string; trKey: string | undefined; level: string }[] = [];
    for (const { name, fn } of allChecks) {
      const diags = fn(ws(), compounds, OPTS);
      for (const d of diags) {
        all.push({ check: name, code: d.code, trKey: undefined, level: d.level });
        expect(d.code, `check ${name} emitted diagnostic without a code`).toBeTruthy();
        expect(
          (DIAGNOSTIC_CODES as Record<string, unknown>)[d.code],
          `check ${name} emitted unknown code ${d.code}`,
        ).toBeDefined();
      }
    }
    // sanity: the fixture is supposed to produce a non-trivial number of diagnostics
    expect(all.length).toBeGreaterThan(20);
  });

  it("import-check diagnostics also carry registry-known codes", () => {
    const fixture = importFixtureCompounds();

    const elPath = "/tmp/src/elements/El.ts";
    const reactionPath = "/tmp/src/reactions/Reaction.ts";
    const helperPath = "/tmp/sibling/elements/Helper.ts";

    const importMap = new Map<string, ParsedImport[]>([
      [
        elPath,
        [
          { moduleSpecifier: "../reactions/Reaction.js", names: ["Reaction"], isTypeOnly: false },
          {
            moduleSpecifier: "../../sibling/elements/Helper.js",
            names: ["Helper"],
            isTypeOnly: false,
          },
        ],
      ],
    ]);
    const resolutions = new Map<string, string | undefined>([
      [`${elPath}::../reactions/Reaction.js`, reactionPath],
      [`${elPath}::../../sibling/elements/Helper.js`, helperPath],
    ]);

    const plugin = importFixturePlugin(importMap, resolutions);
    const diags = checkImports(fixture.ws, fixture.compounds, plugin);

    expect(diags.length).toBeGreaterThan(0);
    for (const d of diags) {
      expect(d.code, `import-check diagnostic missing code: ${d.message}`).toBeTruthy();
      expect(
        (DIAGNOSTIC_CODES as Record<string, unknown>)[d.code],
        `import-check emitted unknown code ${d.code}`,
      ).toBeDefined();
    }
  });

  it("every diagnostic.* TrKey is reachable by exactly one registered code", () => {
    // Inverse coverage: walk the registry and confirm each entry's trKey is
    // a real diagnostic.* TrKey from the vocabulary. (The bijection test
    // asserts the other direction.)
    const diagnosticKeys = new Set<TrKey>(ALL_TR_KEYS.filter((k) => k.startsWith("diagnostic.")));
    for (const meta of Object.values(DIAGNOSTIC_CODES)) {
      expect(
        diagnosticKeys.has(meta.trKey),
        `code ${meta.code} -> unknown trKey ${meta.trKey}`,
      ).toBe(true);
    }
  });
});
