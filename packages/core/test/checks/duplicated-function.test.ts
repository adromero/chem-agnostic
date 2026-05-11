// ---------------------------------------------------------------------------
// CHEM-DRY-001 — unit tests for the pure check function.
//
// Drives `checkDuplicatedFunction` with synthetic `FunctionDeclarationSite`
// arrays so each decision-tree branch (threshold, exclude list, test-path
// exemption, dedup-within-file) is exercised in isolation. Fixture-driven
// integration tests live in `duplicated-function-fixtures.test.ts`; the
// plugin-level AST walk is covered separately by the plugin-typescript
// scan-function-declarations test.
// ---------------------------------------------------------------------------
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import {
  checkDuplicatedFunction,
  DEFAULT_DUPLICATE_FUNCTION_THRESHOLD,
  type DuplicatedFunctionInput,
} from "../../src/checks/duplicated-function.js";
import { NOOP_PLUGIN } from "../helpers/run-fixture.js";
import type { LanguagePlugin } from "../../src/plugin-interface.js";
import type { FunctionDeclarationSite, Workspace, WorkspaceRules } from "../../src/types.js";

function tsPlugin(): LanguagePlugin {
  return {
    ...NOOP_PLUGIN,
    name: "dry-001-unit",
    defaults: {
      publicSurface: "public.ts",
      testFilePattern: /\.test\.ts$/,
      testFrameworkImport: "vitest",
    },
  };
}

function makeWorkspace(rules?: WorkspaceRules): Workspace {
  return {
    workspace: "dry-001-unit",
    language: "typescript",
    roles: { reaction: { description: "", folder: "reactions" } },
    bonds: { reaction: [] },
    paths: { compounds: "./src/compounds" },
    rules,
  };
}

function siteIn(absPath: string, name: string): FunctionDeclarationSite {
  return { functionName: name, absPath };
}

function baseInput(overrides: {
  sites?: Map<string, FunctionDeclarationSite[]>;
  workspace?: Workspace;
  plugin?: LanguagePlugin;
  subtreeId?: string | undefined;
}): DuplicatedFunctionInput {
  return {
    sites: overrides.sites ?? new Map(),
    workspace: overrides.workspace ?? makeWorkspace(),
    plugin: overrides.plugin ?? tsPlugin(),
    subtreeId: "subtreeId" in overrides ? overrides.subtreeId : "default",
  };
}

const FILE = (i: number) => path.resolve(`/abs/c${i}/reactions/handlers.ts`);

describe("checkDuplicatedFunction (DEFAULT_DUPLICATE_FUNCTION_THRESHOLD === 3)", () => {
  it("threshold is 3 (sanity)", () => {
    expect(DEFAULT_DUPLICATE_FUNCTION_THRESHOLD).toBe(3);
  });

  it("fires once when a name appears in exactly the threshold of distinct files", () => {
    const sites = new Map<string, FunctionDeclarationSite[]>([
      [FILE(1), [siteIn(FILE(1), "fieldErrorsFromZod")]],
      [FILE(2), [siteIn(FILE(2), "fieldErrorsFromZod")]],
      [FILE(3), [siteIn(FILE(3), "fieldErrorsFromZod")]],
    ]);
    const diags = checkDuplicatedFunction(baseInput({ sites }));
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.code).toBe("CHEM-DRY-001");
    expect(d.level).toBe("suggestion");
    expect(d.check).toBe("duplicated-function");
    expect(d.language_id).toBe("default");
    expect(d.file).toBeUndefined();
    expect(d.message).toContain("fieldErrorsFromZod");
    expect(d.message).toContain("3");
    expect(d.message).toContain("handlers.ts");
  });

  it("does NOT fire when a name appears in fewer than the threshold files", () => {
    const sites = new Map<string, FunctionDeclarationSite[]>([
      [FILE(1), [siteIn(FILE(1), "validate")]],
      [FILE(2), [siteIn(FILE(2), "validate")]],
    ]);
    const diags = checkDuplicatedFunction(baseInput({ sites }));
    expect(diags).toEqual([]);
  });

  it("respects a user-configured threshold (rules.duplicate_function_threshold)", () => {
    const sites = new Map<string, FunctionDeclarationSite[]>([
      [FILE(1), [siteIn(FILE(1), "x")]],
      [FILE(2), [siteIn(FILE(2), "x")]],
    ]);
    const workspace = makeWorkspace({ duplicate_function_threshold: 2 });
    const diags = checkDuplicatedFunction(baseInput({ sites, workspace }));
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("x");
  });

  it("excludes names in the default exclude list (setup/teardown/beforeEach/afterEach)", () => {
    for (const name of ["setup", "teardown", "beforeEach", "afterEach"]) {
      const sites = new Map<string, FunctionDeclarationSite[]>([
        [FILE(1), [siteIn(FILE(1), name)]],
        [FILE(2), [siteIn(FILE(2), name)]],
        [FILE(3), [siteIn(FILE(3), name)]],
      ]);
      const diags = checkDuplicatedFunction(baseInput({ sites }));
      expect(diags, `${name} should be excluded by default`).toEqual([]);
    }
  });

  it("user-supplied exclude list REPLACES the default (not extends)", () => {
    // With a user-supplied list that omits "setup", "setup" should now fire.
    const sites = new Map<string, FunctionDeclarationSite[]>([
      [FILE(1), [siteIn(FILE(1), "setup")]],
      [FILE(2), [siteIn(FILE(2), "setup")]],
      [FILE(3), [siteIn(FILE(3), "setup")]],
    ]);
    const workspace = makeWorkspace({ duplicate_function_exclude: ["fooBar"] });
    const diags = checkDuplicatedFunction(baseInput({ sites, workspace }));
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("setup");
  });

  it("excludes test files by basename pattern (handlers.test.ts)", () => {
    const TEST = (i: number) => path.resolve(`/abs/c${i}/reactions/handlers.test.ts`);
    const sites = new Map<string, FunctionDeclarationSite[]>([
      [TEST(1), [siteIn(TEST(1), "myThing")]],
      [TEST(2), [siteIn(TEST(2), "myThing")]],
      [TEST(3), [siteIn(TEST(3), "myThing")]],
    ]);
    const diags = checkDuplicatedFunction(baseInput({ sites }));
    expect(diags).toEqual([]);
  });

  it("excludes files under a /tests/ directory component", () => {
    const TF = (i: number) => path.resolve(`/abs/c${i}/tests/handlers.ts`);
    const sites = new Map<string, FunctionDeclarationSite[]>([
      [TF(1), [siteIn(TF(1), "myThing")]],
      [TF(2), [siteIn(TF(2), "myThing")]],
      [TF(3), [siteIn(TF(3), "myThing")]],
    ]);
    const diags = checkDuplicatedFunction(baseInput({ sites }));
    expect(diags).toEqual([]);
  });

  it("counts a single file ONCE even when it declares the same name twice (overload-impl pattern)", () => {
    // 2 distinct non-test files, but file #1 declares "x" twice (overload).
    // Should NOT cross the threshold of 3.
    const sites = new Map<string, FunctionDeclarationSite[]>([
      [FILE(1), [siteIn(FILE(1), "x"), siteIn(FILE(1), "x")]],
      [FILE(2), [siteIn(FILE(2), "x")]],
    ]);
    const diags = checkDuplicatedFunction(baseInput({ sites }));
    expect(diags).toEqual([]);
  });

  it("returns empty when sites map is empty (covers the plugin-omits-method case)", () => {
    const diags = checkDuplicatedFunction(baseInput({ sites: new Map() }));
    expect(diags).toEqual([]);
  });

  it("emits ONE diagnostic per duplicated name even with many duplicates", () => {
    const sites = new Map<string, FunctionDeclarationSite[]>([
      [FILE(1), [siteIn(FILE(1), "x"), siteIn(FILE(1), "y")]],
      [FILE(2), [siteIn(FILE(2), "x"), siteIn(FILE(2), "y")]],
      [FILE(3), [siteIn(FILE(3), "x"), siteIn(FILE(3), "y")]],
      [FILE(4), [siteIn(FILE(4), "x"), siteIn(FILE(4), "y")]],
    ]);
    const diags = checkDuplicatedFunction(baseInput({ sites }));
    expect(diags).toHaveLength(2);
    const codes = diags.map((d) => d.code);
    expect(codes).toEqual(["CHEM-DRY-001", "CHEM-DRY-001"]);
    // Deterministic order — names are sorted.
    expect(diags[0].message).toContain("x");
    expect(diags[1].message).toContain("y");
  });

  it("omits language_id when subtreeId is undefined", () => {
    const sites = new Map<string, FunctionDeclarationSite[]>([
      [FILE(1), [siteIn(FILE(1), "z")]],
      [FILE(2), [siteIn(FILE(2), "z")]],
      [FILE(3), [siteIn(FILE(3), "z")]],
    ]);
    const diags = checkDuplicatedFunction(baseInput({ sites, subtreeId: undefined }));
    expect(diags).toHaveLength(1);
    expect(diags[0].language_id).toBeUndefined();
  });
});
