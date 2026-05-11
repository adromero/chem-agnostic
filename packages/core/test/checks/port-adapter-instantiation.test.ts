// ---------------------------------------------------------------------------
// CHEM-PORT-004 — unit tests for the pure check function.
//
// Drives `checkPortAdapterInstantiation` with synthetic `NewExpressionSite`
// arrays and pre-built `fileIndex` / `compoundMap` so each branch of the
// decision tree is exercised in isolation. Fixture-driven integration tests
// (using `runFixture` with a mock plugin that implements
// `scanNewExpressions`) live in `port-adapter-instantiation-fixtures.test.ts`.
// ---------------------------------------------------------------------------
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import {
  checkPortAdapterInstantiation,
  type PortAdapterInstantiationCompoundEntry,
  type PortAdapterInstantiationFileEntry,
  type PortAdapterInstantiationInput,
} from "../../src/checks/port-adapter-instantiation.js";
import { compileClassAllowlist } from "../../src/checks/port-class-import.js";
import { NOOP_PLUGIN } from "../helpers/run-fixture.js";
import type { LanguagePlugin } from "../../src/plugin-interface.js";
import type { LoadedCompound, NewExpressionSite, Workspace } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tsPlugin(): LanguagePlugin {
  return {
    ...NOOP_PLUGIN,
    name: "port-004-unit",
    defaults: {
      publicSurface: "public.ts",
      testFilePattern: /\.test\.ts$/,
      testFrameworkImport: "vitest",
    },
  };
}

function makeCompound(
  name: string,
  type?: "compound" | "reagent" | "solvent" | "catalyst",
): LoadedCompound {
  const manifest: { compound: string; type?: typeof type } = { compound: name };
  if (type) manifest.type = type;
  return { manifest, dir: `/synthetic/compounds/${name}` };
}

function makeWorkspace(): Workspace {
  return {
    workspace: "port-004-unit",
    language: "typescript",
    roles: {
      reaction: { description: "", folder: "reactions" },
      interface: { description: "", folder: "interfaces" },
      adapter: { description: "", folder: "adapters" },
    },
    bonds: { reaction: ["interface", "adapter"], interface: [], adapter: ["interface"] },
    paths: { compounds: "./src/compounds" },
  };
}

const CALLER = path.resolve("/abs/vendors/reactions/handlers.ts");
const DECL = path.resolve("/abs/vendors/adapters/VendorRepo.ts");

function baseInput(overrides: {
  site?: Partial<NewExpressionSite>;
  fileIndex?: Map<string, PortAdapterInstantiationFileEntry>;
  compoundMap?: Map<string, PortAdapterInstantiationCompoundEntry>;
  plugin?: LanguagePlugin;
  classAllowlist?: Set<string>;
  subtreeId?: string | undefined;
}): PortAdapterInstantiationInput {
  const site: NewExpressionSite = {
    callerAbsPath: CALLER,
    className: "VendorRepo",
    constructorDeclAbsPath: DECL,
    isTransient: false,
    ...overrides.site,
  };

  const fileIndex =
    overrides.fileIndex ??
    new Map<string, PortAdapterInstantiationFileEntry>([
      [CALLER, { compound: "vendors", unit: "handlers", role: "reaction", subtreeId: "default" }],
      [DECL, { compound: "vendors", unit: "VendorRepo", role: "adapter", subtreeId: "default" }],
    ]);

  const compoundMap =
    overrides.compoundMap ??
    new Map<string, PortAdapterInstantiationCompoundEntry>([
      ["vendors", { compound: makeCompound("vendors", "compound"), subtreeId: "default" }],
    ]);

  return {
    sites: new Map([[CALLER, [site]]]),
    fileIndex,
    compoundMap,
    workspace: makeWorkspace(),
    plugin: overrides.plugin ?? tsPlugin(),
    classAllowlist: overrides.classAllowlist ?? compileClassAllowlist(undefined),
    subtreeId: "subtreeId" in overrides ? overrides.subtreeId : "default",
  };
}

// ---------------------------------------------------------------------------
// Decision-tree branches
// ---------------------------------------------------------------------------

describe("checkPortAdapterInstantiation", () => {
  it("fires once on a non-catalyst caller instantiating an adapter class", () => {
    const diags = checkPortAdapterInstantiation(baseInput({}));
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.code).toBe("CHEM-PORT-004");
    expect(d.level).toBe("error");
    expect(d.check).toBe("port-adapter-instantiation");
    expect(d.compound).toBe("vendors");
    expect(d.language_id).toBe("default");
    expect(d.file).toBe(CALLER);
    expect(d.message).toContain("VendorRepo");
    expect(d.message).toContain("vendors");
    // No first-class remediation in v1.
    expect(d.remediation).toBeUndefined();
    expect(d.hint).toContain("catalyst");
    expect(d.hint).toContain("@chemag-transient");
  });

  it("skips when isTransient === true", () => {
    const diags = checkPortAdapterInstantiation(baseInput({ site: { isTransient: true } }));
    expect(diags).toEqual([]);
  });

  it("skips when className is in the default allowlist", () => {
    for (const name of ["Date", "URL", "Money", "RegExp"]) {
      const diags = checkPortAdapterInstantiation(baseInput({ site: { className: name } }));
      expect(diags, `allowlisted ${name} should not fire`).toEqual([]);
    }
  });

  it("skips when className is in the user-extended allowlist", () => {
    const diags = checkPortAdapterInstantiation(
      baseInput({
        site: { className: "MyCustomClass" },
        classAllowlist: compileClassAllowlist(["MyCustomClass"]),
      }),
    );
    expect(diags).toEqual([]);
  });

  it("skips when the caller path matches the plugin's testFilePattern", () => {
    const testCaller = path.resolve("/abs/vendors/reactions/handlers.test.ts");
    const fileIndex = new Map<string, PortAdapterInstantiationFileEntry>([
      [
        testCaller,
        { compound: "vendors", unit: "handlers", role: "reaction", subtreeId: "default" },
      ],
      [DECL, { compound: "vendors", unit: "VendorRepo", role: "adapter", subtreeId: "default" }],
    ]);
    const diags = checkPortAdapterInstantiation(
      baseInput({ site: { callerAbsPath: testCaller }, fileIndex }),
    );
    expect(diags).toEqual([]);
  });

  it("skips when caller lives under a /tests/ directory component", () => {
    const testCaller = path.resolve("/abs/vendors/tests/handlers.ts");
    const fileIndex = new Map<string, PortAdapterInstantiationFileEntry>([
      [
        testCaller,
        { compound: "vendors", unit: "handlers", role: "reaction", subtreeId: "default" },
      ],
      [DECL, { compound: "vendors", unit: "VendorRepo", role: "adapter", subtreeId: "default" }],
    ]);
    const diags = checkPortAdapterInstantiation(
      baseInput({ site: { callerAbsPath: testCaller }, fileIndex }),
    );
    expect(diags).toEqual([]);
  });

  it("skips when constructorDeclAbsPath is undefined (resolver gave up)", () => {
    const diags = checkPortAdapterInstantiation(
      baseInput({ site: { constructorDeclAbsPath: undefined } }),
    );
    expect(diags).toEqual([]);
  });

  it("skips when the declaration file is outside fileIndex (e.g. node_modules)", () => {
    const diags = checkPortAdapterInstantiation(
      baseInput({
        site: { constructorDeclAbsPath: path.resolve("/abs/node_modules/foo/index.ts") },
      }),
    );
    expect(diags).toEqual([]);
  });

  it("skips when the resolved declaration's role is not 'adapter'", () => {
    const fileIndex = new Map<string, PortAdapterInstantiationFileEntry>([
      [CALLER, { compound: "vendors", unit: "handlers", role: "reaction", subtreeId: "default" }],
      [DECL, { compound: "vendors", unit: "VendorRepo", role: "interface", subtreeId: "default" }],
    ]);
    const diags = checkPortAdapterInstantiation(baseInput({ fileIndex }));
    expect(diags).toEqual([]);
  });

  it("skips when caller is outside fileIndex (defensive)", () => {
    const fileIndex = new Map<string, PortAdapterInstantiationFileEntry>([
      // CALLER intentionally absent.
      [DECL, { compound: "vendors", unit: "VendorRepo", role: "adapter", subtreeId: "default" }],
    ]);
    const diags = checkPortAdapterInstantiation(baseInput({ fileIndex }));
    expect(diags).toEqual([]);
  });

  it("skips when caller's compound is missing from compoundMap (defensive)", () => {
    const compoundMap = new Map<string, PortAdapterInstantiationCompoundEntry>();
    const diags = checkPortAdapterInstantiation(baseInput({ compoundMap }));
    expect(diags).toEqual([]);
  });

  it("skips when caller's compound type is 'catalyst'", () => {
    const compoundMap = new Map<string, PortAdapterInstantiationCompoundEntry>([
      ["vendors", { compound: makeCompound("vendors", "catalyst"), subtreeId: "default" }],
    ]);
    const diags = checkPortAdapterInstantiation(baseInput({ compoundMap }));
    expect(diags).toEqual([]);
  });

  it("omits language_id when subtreeId is undefined", () => {
    const diags = checkPortAdapterInstantiation(baseInput({ subtreeId: undefined }));
    expect(diags).toHaveLength(1);
    expect(diags[0].language_id).toBeUndefined();
  });

  it("emits one diagnostic per offending call site (multiple sites in one file)", () => {
    const site2: NewExpressionSite = {
      callerAbsPath: CALLER,
      className: "VendorRepo",
      constructorDeclAbsPath: DECL,
      isTransient: false,
    };
    const input = baseInput({});
    input.sites = new Map([[CALLER, [{ ...site2 }, { ...site2 }]]]);
    const diags = checkPortAdapterInstantiation(input);
    expect(diags).toHaveLength(2);
    expect(diags.every((d) => d.code === "CHEM-PORT-004")).toBe(true);
  });

  it("returns [] when sites map is empty", () => {
    const input = baseInput({});
    input.sites = new Map();
    const diags = checkPortAdapterInstantiation(input);
    expect(diags).toEqual([]);
  });

  it("returns [] when a file's site array is empty", () => {
    const input = baseInput({});
    input.sites = new Map([[CALLER, []]]);
    const diags = checkPortAdapterInstantiation(input);
    expect(diags).toEqual([]);
  });
});
