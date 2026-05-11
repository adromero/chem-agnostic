// ---------------------------------------------------------------------------
// CHEM-PORT-003 — unit tests for the pure check function and the allowlist
// compiler. Fixture-driven integration tests live in
// `port-class-import-fixtures.test.ts` (they need the real `typescriptPlugin`
// to populate `declarationKind`, which this file does not — these tests
// drive the check directly with synthetic `ParsedImport`s).
// ---------------------------------------------------------------------------
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import {
  DEFAULT_CLASS_ALLOWLIST,
  checkPortClassImport,
  compileClassAllowlist,
  type PortClassImportInput,
} from "../../src/checks/port-class-import.js";
import { NOOP_PLUGIN } from "../helpers/run-fixture.js";
import type { LanguagePlugin } from "../../src/plugin-interface.js";
import type { LoadedCompound, ParsedImport, Workspace } from "../../src/types.js";

// ---------------------------------------------------------------------------
// compileClassAllowlist
// ---------------------------------------------------------------------------

describe("compileClassAllowlist", () => {
  it("returns exactly the four defaults when no user patterns supplied", () => {
    const out = compileClassAllowlist(undefined);
    expect(out.size).toBe(DEFAULT_CLASS_ALLOWLIST.length);
    for (const name of DEFAULT_CLASS_ALLOWLIST) {
      expect(out.has(name)).toBe(true);
    }
  });

  it("EXTENDS (not replaces) the default allowlist with user entries", () => {
    const out = compileClassAllowlist(["Foo"]);
    expect(out.size).toBe(DEFAULT_CLASS_ALLOWLIST.length + 1);
    expect(out.has("Foo")).toBe(true);
    for (const name of DEFAULT_CLASS_ALLOWLIST) {
      expect(out.has(name)).toBe(true);
    }
  });

  it("returns a fresh Set on each call (no shared mutable state)", () => {
    const a = compileClassAllowlist(undefined);
    const b = compileClassAllowlist(undefined);
    expect(a).not.toBe(b);
    a.add("Mutated");
    expect(b.has("Mutated")).toBe(false);
  });

  it("treats an empty user array as 'no extras'", () => {
    const out = compileClassAllowlist([]);
    expect(out.size).toBe(DEFAULT_CLASS_ALLOWLIST.length);
  });
});

// ---------------------------------------------------------------------------
// checkPortClassImport
// ---------------------------------------------------------------------------

function makeCompound(name: string, type?: string): LoadedCompound {
  const manifest: { compound: string; type?: "compound" | "reagent" | "solvent" | "catalyst" } = {
    compound: name,
  };
  if (type) manifest.type = type as "compound" | "reagent" | "solvent" | "catalyst";
  return { manifest, dir: `/synthetic/compounds/${name}` };
}

function makeWorkspace(overrides?: Partial<Workspace>): Workspace {
  return {
    workspace: "port-003-unit",
    language: "typescript",
    roles: {
      reaction: { description: "", folder: "reactions" },
      interface: { description: "", folder: "interfaces" },
      adapter: { description: "", folder: "adapters" },
    },
    bonds: { reaction: ["interface"], interface: [], adapter: ["interface"] },
    paths: { compounds: "./src/compounds" },
    ...overrides,
  };
}

function makeInput(overrides: Partial<PortClassImportInput>): PortClassImportInput {
  const srcCompound = overrides.srcCompound ?? makeCompound("a");
  const targetCompound = overrides.targetCompound ?? makeCompound("b");
  return {
    srcAbs: "/abs/a/reactions/useStore.ts",
    srcCompound,
    targetCompound,
    imp: {
      moduleSpecifier: "../../b/public",
      names: ["VendorRepository"],
      isTypeOnly: false,
      declarationKind: "class",
    },
    workspace: makeWorkspace(),
    plugin: typedPlugin(),
    allowlist: compileClassAllowlist(undefined),
    subtreeId: "default",
    ...overrides,
  };
}

/** A LanguagePlugin whose `testFilePattern` matches the real TS plugin's
 *  basename regex so the tests exercise the same code path as production. */
function typedPlugin(): LanguagePlugin {
  return {
    ...NOOP_PLUGIN,
    name: "port-003-unit",
    defaults: {
      publicSurface: "public.ts",
      testFilePattern: /\.test\.ts$/,
      testFrameworkImport: "vitest",
    },
  };
}

describe("checkPortClassImport", () => {
  it("returns [] when declarationKind is undefined (plugin opted out)", () => {
    const diags = checkPortClassImport(
      makeInput({ imp: { moduleSpecifier: "x", names: ["X"], isTypeOnly: false } }),
    );
    expect(diags).toEqual([]);
  });

  it("returns [] when declarationKind is 'unresolved'", () => {
    const diags = checkPortClassImport(
      makeInput({
        imp: {
          moduleSpecifier: "x",
          names: ["X"],
          isTypeOnly: false,
          declarationKind: "unresolved",
        },
      }),
    );
    expect(diags).toEqual([]);
  });

  it("returns [] for type-only imports even when declarationKind === 'class'", () => {
    const diags = checkPortClassImport(
      makeInput({
        imp: {
          moduleSpecifier: "x",
          names: ["VendorRepository"],
          isTypeOnly: true,
          declarationKind: "class",
        },
      }),
    );
    expect(diags).toEqual([]);
  });

  it("returns [] when the class name is in the default allowlist", () => {
    for (const name of DEFAULT_CLASS_ALLOWLIST) {
      const diags = checkPortClassImport(
        makeInput({
          imp: {
            moduleSpecifier: "x",
            names: [name],
            isTypeOnly: false,
            declarationKind: "class",
          },
        }),
      );
      expect(diags, `allowlisted ${name} should not fire`).toEqual([]);
    }
  });

  it("returns [] when the class name is in the user-extended allowlist", () => {
    const diags = checkPortClassImport(
      makeInput({
        allowlist: compileClassAllowlist(["MyCustomClass"]),
        imp: {
          moduleSpecifier: "x",
          names: ["MyCustomClass"],
          isTypeOnly: false,
          declarationKind: "class",
        },
      }),
    );
    expect(diags).toEqual([]);
  });

  it("emits exactly one diagnostic when declarationKind === 'class' and name is not allowlisted", () => {
    const diags = checkPortClassImport(makeInput({}));
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("CHEM-PORT-003");
    expect(diags[0].level).toBe("error");
    expect(diags[0].check).toBe("port-class-import");
    expect(diags[0].compound).toBe("a");
    expect(diags[0].language_id).toBe("default");
    expect(diags[0].message).toContain("VendorRepository");
    expect(diags[0].message).toContain("b");
    expect(diags[0].file).toBe("/abs/a/reactions/useStore.ts");
    expect(diags[0].remediation).toEqual({ kind: "use_interface", interface_candidates: [] });
  });

  it("returns [] for declarationKind === 'interface'", () => {
    const diags = checkPortClassImport(
      makeInput({
        imp: {
          moduleSpecifier: "x",
          names: ["VendorStore"],
          isTypeOnly: false,
          declarationKind: "interface",
        },
      }),
    );
    expect(diags).toEqual([]);
  });

  it("returns [] for declarationKind === 'type'", () => {
    const diags = checkPortClassImport(
      makeInput({
        imp: {
          moduleSpecifier: "x",
          names: ["Vendor"],
          isTypeOnly: false,
          declarationKind: "type",
        },
      }),
    );
    expect(diags).toEqual([]);
  });

  it("returns [] for declarationKind === 'function'", () => {
    const diags = checkPortClassImport(
      makeInput({
        imp: {
          moduleSpecifier: "x",
          names: ["formatMoney"],
          isTypeOnly: false,
          declarationKind: "function",
        },
      }),
    );
    expect(diags).toEqual([]);
  });

  // -------- test-file exemption --------

  it("returns [] when the source basename matches the plugin's testFilePattern", () => {
    const diags = checkPortClassImport(makeInput({ srcAbs: "/abs/a/reactions/store.test.ts" }));
    expect(diags).toEqual([]);
  });

  it("returns [] when the source path contains a /tests/ directory component", () => {
    const diags = checkPortClassImport(
      makeInput({ srcAbs: path.join("/abs", "a", "tests", "store.ts") }),
    );
    expect(diags).toEqual([]);
  });

  it("returns [] when the source path contains a /__tests__/ directory component", () => {
    const diags = checkPortClassImport(
      makeInput({ srcAbs: path.join("/abs", "a", "__tests__", "store.ts") }),
    );
    expect(diags).toEqual([]);
  });

  it("FIRES on paths containing the substring 'tests' inside a non-segment word (regression guard)", () => {
    // `treats.ts` contains the substring "treat" + "s", not the segment "tests".
    // A naive `.includes("tests")` would misfire here; the directory-component
    // check must not.
    const diags = checkPortClassImport(
      makeInput({ srcAbs: path.join("/abs", "a", "reactions", "treats.ts") }),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("CHEM-PORT-003");
  });

  // -------- reagent exemption --------

  it("returns [] when the target compound has type 'reagent'", () => {
    const diags = checkPortClassImport(
      makeInput({ targetCompound: makeCompound("shared", "reagent") }),
    );
    expect(diags).toEqual([]);
  });

  it("returns [] when the target compound's type is implicit in workspace.compound_types", () => {
    const diags = checkPortClassImport(
      makeInput({
        targetCompound: makeCompound("infra", "solvent"),
        workspace: makeWorkspace({
          compound_types: {
            solvent: { description: "infra", implicit: true },
          },
        }),
      }),
    );
    expect(diags).toEqual([]);
  });

  // -------- multi-name cardinality --------

  it("emits exactly one diagnostic for a multi-named import statement (cites first non-allowlisted name)", () => {
    const diags = checkPortClassImport(
      makeInput({
        imp: {
          moduleSpecifier: "x",
          names: ["Date", "VendorRepository", "AnotherClass"],
          isTypeOnly: false,
          declarationKind: "class",
        },
      }),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("VendorRepository");
    expect(diags[0].message).not.toContain("AnotherClass");
  });

  // -------- defensive --------

  it("returns [] when targetCompound is undefined", () => {
    const diags = checkPortClassImport(makeInput({ targetCompound: undefined }));
    expect(diags).toEqual([]);
  });
});
