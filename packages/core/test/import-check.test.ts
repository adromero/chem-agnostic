import { describe, it, expect } from "vitest";
import { checkImports } from "../src/import-check.js";
import type { Workspace, LoadedCompound, Compound, ParsedImport } from "../src/types.js";
import type { LanguagePlugin } from "../src/plugin-interface.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ws(overrides?: Partial<Workspace>): Workspace {
  return {
    workspace: "test",
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
        importable_by: "all",
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
    rules: {
      cross_compound_imports: "public_only",
      role_from_path: true,
      public_surface: "public.ts",
    },
    ...overrides,
  };
}

function lc(manifest: Compound, dir: string): LoadedCompound {
  return { manifest, dir };
}

/**
 * Build a mock plugin that returns predetermined import data.
 *
 * @param importMap   file path -> ParsedImport[] (what parseImportsBatch returns)
 * @param resolutions [fromFile, moduleSpec] -> absolute resolved path (resolveModulePath)
 */
function mockPlugin(
  importMap: Map<string, ParsedImport[]>,
  resolutions: Map<string, string | undefined>,
): LanguagePlugin {
  return {
    name: "mock",
    fileExtensions: [".ts"],
    defaults: {
      publicSurface: "public.ts",
      testFilePattern: /\.test\.ts$/,
      testFrameworkImport: "vitest",
    },
    parseImportsBatch(paths: string[]): Map<string, ParsedImport[]> {
      const result = new Map<string, ParsedImport[]>();
      for (const p of paths) {
        result.set(p, importMap.get(p) ?? []);
      }
      return result;
    },
    parseImports() {
      return [];
    },
    resolveModulePath(_fromFile: string, moduleSpec: string): string | undefined {
      return resolutions.get(moduleSpec);
    },
    generateUnitStub() {
      return "";
    },
    generatePublicSurface() {
      return "";
    },
    generateAssayStub() {
      return "";
    },
    unitFilePath() {
      return "";
    },
    formatRelativeImport() {
      return "";
    },
    formatImportStatement() {
      return "";
    },
    inferUnits() {
      return [];
    },
    inferImplements() {
      return [];
    },
    isSourceFile() {
      return true;
    },
    generateClaudeMd() {
      return "";
    },
  } as unknown as LanguagePlugin;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkImports", () => {
  describe("bond violations", () => {
    it("detects element importing a reaction (bond violation)", () => {
      const compoundA = lc(
        {
          compound: "a",
          units: [
            { role: "element", name: "UserId", file: "./elements/UserId.ts" },
            { role: "reaction", name: "DoStuff", file: "./reactions/DoStuff.ts" },
          ],
        },
        "/project/compounds/a",
      );

      const elementPath = "/project/compounds/a/elements/UserId.ts";
      const reactionPath = "/project/compounds/a/reactions/DoStuff.ts";

      const importMap = new Map<string, ParsedImport[]>([
        [
          elementPath,
          [{ moduleSpecifier: "../reactions/DoStuff", names: ["DoStuff"], isTypeOnly: false }],
        ],
        [reactionPath, []],
      ]);

      const resolutions = new Map<string, string | undefined>([
        ["../reactions/DoStuff", reactionPath],
      ]);

      const plugin = mockPlugin(importMap, resolutions);
      const diags = checkImports(ws(), [
        {
          plugin,
          scope: { id: "default", language: "typescript", paths: { compounds: "./src" } },
          compounds: [compoundA],
        },
      ]);

      expect(diags.length).toBeGreaterThanOrEqual(1);
      const bondDiag = diags.find((d) => d.check === "import-bonds");
      expect(bondDiag).toBeDefined();
      expect(bondDiag!.level).toBe("error");
      expect(bondDiag!.message).toMatch(/violation/);
    });
  });

  describe("allowed bonds", () => {
    it("allows reaction importing an interface (valid bond)", () => {
      const compoundA = lc(
        {
          compound: "a",
          units: [
            { role: "reaction", name: "DoStuff", file: "./reactions/DoStuff.ts" },
            { role: "interface", name: "Repo", file: "./interfaces/Repo.ts" },
          ],
        },
        "/project/compounds/a",
      );

      const reactionPath = "/project/compounds/a/reactions/DoStuff.ts";
      const interfacePath = "/project/compounds/a/interfaces/Repo.ts";

      const importMap = new Map<string, ParsedImport[]>([
        [
          reactionPath,
          [{ moduleSpecifier: "../interfaces/Repo", names: ["Repo"], isTypeOnly: false }],
        ],
        [interfacePath, []],
      ]);

      const resolutions = new Map<string, string | undefined>([
        ["../interfaces/Repo", interfacePath],
      ]);

      const plugin = mockPlugin(importMap, resolutions);
      const diags = checkImports(ws(), [
        {
          plugin,
          scope: { id: "default", language: "typescript", paths: { compounds: "./src" } },
          compounds: [compoundA],
        },
      ]);

      expect(diags).toHaveLength(0);
    });
  });

  describe("cross-compound bypass", () => {
    it("detects import from internal file instead of public surface", () => {
      const compoundA = lc(
        {
          compound: "a",
          imports: [{ compound: "b" }],
          units: [{ role: "reaction", name: "DoStuff", file: "./reactions/DoStuff.ts" }],
        },
        "/project/compounds/a",
      );

      const compoundB = lc(
        {
          compound: "b",
          units: [{ role: "interface", name: "Repo", file: "./interfaces/Repo.ts" }],
        },
        "/project/compounds/b",
      );

      const reactionPath = "/project/compounds/a/reactions/DoStuff.ts";
      const internalPath = "/project/compounds/b/interfaces/Repo.ts";

      const importMap = new Map<string, ParsedImport[]>([
        [
          reactionPath,
          [{ moduleSpecifier: "../../b/interfaces/Repo", names: ["Repo"], isTypeOnly: false }],
        ],
        [internalPath, []],
      ]);

      const resolutions = new Map<string, string | undefined>([
        ["../../b/interfaces/Repo", internalPath],
      ]);

      const plugin = mockPlugin(importMap, resolutions);
      const diags = checkImports(ws(), [
        {
          plugin,
          scope: { id: "default", language: "typescript", paths: { compounds: "./src" } },
          compounds: [compoundA, compoundB],
        },
      ]);

      const bypass = diags.find((d) => d.check === "import-bypass");
      expect(bypass).toBeDefined();
      expect(bypass!.level).toBe("error");
      expect(bypass!.message).toContain("internal file");
    });
  });

  describe("undeclared cross-compound import", () => {
    it("detects import from a compound not in the imports list", () => {
      // compoundA does NOT declare compoundB in its imports
      const compoundA = lc(
        {
          compound: "a",
          imports: [], // no imports declared
          units: [{ role: "reaction", name: "DoStuff", file: "./reactions/DoStuff.ts" }],
        },
        "/project/compounds/a",
      );

      const compoundB = lc(
        {
          compound: "b",
          units: [{ role: "interface", name: "Repo", file: "./interfaces/Repo.ts" }],
        },
        "/project/compounds/b",
      );

      const reactionPath = "/project/compounds/a/reactions/DoStuff.ts";
      const internalPath = "/project/compounds/b/interfaces/Repo.ts";

      const importMap = new Map<string, ParsedImport[]>([
        [
          reactionPath,
          [{ moduleSpecifier: "../../b/interfaces/Repo", names: ["Repo"], isTypeOnly: false }],
        ],
        [internalPath, []],
      ]);

      const resolutions = new Map<string, string | undefined>([
        ["../../b/interfaces/Repo", internalPath],
      ]);

      const plugin = mockPlugin(importMap, resolutions);
      const diags = checkImports(ws(), [
        {
          plugin,
          scope: { id: "default", language: "typescript", paths: { compounds: "./src" } },
          compounds: [compoundA, compoundB],
        },
      ]);

      const undeclared = diags.find((d) => d.check === "import-undeclared");
      expect(undeclared).toBeDefined();
      expect(undeclared!.level).toBe("error");
      expect(undeclared!.message).toContain("not in the imports list");
    });
  });

  describe("type-only imports", () => {
    it("applies same bond rules to type-only imports", () => {
      const compoundA = lc(
        {
          compound: "a",
          units: [
            { role: "element", name: "UserId", file: "./elements/UserId.ts" },
            { role: "reaction", name: "DoStuff", file: "./reactions/DoStuff.ts" },
          ],
        },
        "/project/compounds/a",
      );

      const elementPath = "/project/compounds/a/elements/UserId.ts";
      const reactionPath = "/project/compounds/a/reactions/DoStuff.ts";

      const importMap = new Map<string, ParsedImport[]>([
        [
          elementPath,
          [{ moduleSpecifier: "../reactions/DoStuff", names: ["DoStuff"], isTypeOnly: true }],
        ],
        [reactionPath, []],
      ]);

      const resolutions = new Map<string, string | undefined>([
        ["../reactions/DoStuff", reactionPath],
      ]);

      const plugin = mockPlugin(importMap, resolutions);
      const diags = checkImports(ws(), [
        {
          plugin,
          scope: { id: "default", language: "typescript", paths: { compounds: "./src" } },
          compounds: [compoundA],
        },
      ]);

      // Type-only should still trigger a bond violation
      const bondDiag = diags.find((d) => d.check === "import-bonds");
      expect(bondDiag).toBeDefined();
      expect(bondDiag!.level).toBe("error");
    });

    it("applies same cross-compound rules to type-only imports", () => {
      const compoundA = lc(
        {
          compound: "a",
          imports: [],
          units: [{ role: "reaction", name: "DoStuff", file: "./reactions/DoStuff.ts" }],
        },
        "/project/compounds/a",
      );

      const compoundB = lc(
        {
          compound: "b",
          units: [{ role: "interface", name: "Repo", file: "./interfaces/Repo.ts" }],
        },
        "/project/compounds/b",
      );

      const reactionPath = "/project/compounds/a/reactions/DoStuff.ts";
      const internalPath = "/project/compounds/b/interfaces/Repo.ts";

      const importMap = new Map<string, ParsedImport[]>([
        [
          reactionPath,
          [{ moduleSpecifier: "../../b/interfaces/Repo", names: ["Repo"], isTypeOnly: true }],
        ],
        [internalPath, []],
      ]);

      const resolutions = new Map<string, string | undefined>([
        ["../../b/interfaces/Repo", internalPath],
      ]);

      const plugin = mockPlugin(importMap, resolutions);
      const diags = checkImports(ws(), [
        {
          plugin,
          scope: { id: "default", language: "typescript", paths: { compounds: "./src" } },
          compounds: [compoundA, compoundB],
        },
      ]);

      expect(diags.find((d) => d.check === "import-undeclared")).toBeDefined();
      expect(diags.find((d) => d.check === "import-bypass")).toBeDefined();
    });
  });

  describe("external/unresolved imports", () => {
    it("skips external imports that resolve to undefined", () => {
      const compoundA = lc(
        {
          compound: "a",
          units: [{ role: "reaction", name: "DoStuff", file: "./reactions/DoStuff.ts" }],
        },
        "/project/compounds/a",
      );

      const reactionPath = "/project/compounds/a/reactions/DoStuff.ts";

      const importMap = new Map<string, ParsedImport[]>([
        [
          reactionPath,
          [
            { moduleSpecifier: "lodash", names: ["map"], isTypeOnly: false },
            { moduleSpecifier: "node:path", names: ["join"], isTypeOnly: false },
          ],
        ],
      ]);

      // External/stdlib modules resolve to undefined
      const resolutions = new Map<string, string | undefined>([
        ["lodash", undefined],
        ["node:path", undefined],
      ]);

      const plugin = mockPlugin(importMap, resolutions);
      const diags = checkImports(ws(), [
        {
          plugin,
          scope: { id: "default", language: "typescript", paths: { compounds: "./src" } },
          compounds: [compoundA],
        },
      ]);

      expect(diags).toHaveLength(0);
    });

    it("skips imports that resolve to files not in the file index", () => {
      const compoundA = lc(
        {
          compound: "a",
          units: [{ role: "reaction", name: "DoStuff", file: "./reactions/DoStuff.ts" }],
        },
        "/project/compounds/a",
      );

      const reactionPath = "/project/compounds/a/reactions/DoStuff.ts";

      const importMap = new Map<string, ParsedImport[]>([
        [
          reactionPath,
          [{ moduleSpecifier: "../utils/helpers", names: ["helper"], isTypeOnly: false }],
        ],
      ]);

      // Resolves to a file but it's not a known chem unit
      const resolutions = new Map<string, string | undefined>([
        ["../utils/helpers", "/project/compounds/a/utils/helpers.ts"],
      ]);

      const plugin = mockPlugin(importMap, resolutions);
      const diags = checkImports(ws(), [
        {
          plugin,
          scope: { id: "default", language: "typescript", paths: { compounds: "./src" } },
          compounds: [compoundA],
        },
      ]);

      expect(diags).toHaveLength(0);
    });
  });

  describe("implicit solvents", () => {
    it("allows cross-compound import from implicit solvent without declaration", () => {
      const compoundA = lc(
        {
          compound: "a",
          imports: [], // no explicit import of "logging"
          units: [{ role: "reaction", name: "DoStuff", file: "./reactions/DoStuff.ts" }],
        },
        "/project/compounds/a",
      );

      const solvent = lc(
        {
          compound: "logging",
          type: "solvent",
          units: [{ role: "interface", name: "Logger", file: "./interfaces/Logger.ts" }],
        },
        "/project/solvents/logging",
      );

      const reactionPath = "/project/compounds/a/reactions/DoStuff.ts";
      const publicPath = "/project/solvents/logging/public.ts";

      const importMap = new Map<string, ParsedImport[]>([
        [
          reactionPath,
          [
            {
              moduleSpecifier: "../../../solvents/logging/public",
              names: ["Logger"],
              isTypeOnly: false,
            },
          ],
        ],
        ["/project/solvents/logging/interfaces/Logger.ts", []],
      ]);

      // Import resolves to the public surface of the solvent
      const resolutions = new Map<string, string | undefined>([
        ["../../../solvents/logging/public", publicPath],
      ]);

      const plugin = mockPlugin(importMap, resolutions);
      const diags = checkImports(ws(), [
        {
          plugin,
          scope: { id: "default", language: "typescript", paths: { compounds: "./src" } },
          compounds: [compoundA, solvent],
        },
      ]);

      // No undeclared error because solvents are implicit
      const undeclared = diags.filter((d) => d.check === "import-undeclared");
      expect(undeclared).toHaveLength(0);
    });
  });

  describe("cross-compound through public surface", () => {
    it("allows valid cross-compound import through public surface", () => {
      const compoundA = lc(
        {
          compound: "a",
          imports: [{ compound: "b" }],
          units: [{ role: "reaction", name: "DoStuff", file: "./reactions/DoStuff.ts" }],
        },
        "/project/compounds/a",
      );

      const compoundB = lc(
        {
          compound: "b",
          units: [{ role: "interface", name: "Repo", file: "./interfaces/Repo.ts" }],
        },
        "/project/compounds/b",
      );

      const reactionPath = "/project/compounds/a/reactions/DoStuff.ts";
      const publicPath = "/project/compounds/b/public.ts";

      const importMap = new Map<string, ParsedImport[]>([
        [reactionPath, [{ moduleSpecifier: "../../b/public", names: ["Repo"], isTypeOnly: false }]],
        ["/project/compounds/b/interfaces/Repo.ts", []],
      ]);

      const resolutions = new Map<string, string | undefined>([["../../b/public", publicPath]]);

      const plugin = mockPlugin(importMap, resolutions);
      const diags = checkImports(ws(), [
        {
          plugin,
          scope: { id: "default", language: "typescript", paths: { compounds: "./src" } },
          compounds: [compoundA, compoundB],
        },
      ]);

      expect(diags).toHaveLength(0);
    });
  });

  describe("unrestricted cross-compound mode", () => {
    it("skips cross-compound checks when rule is unrestricted", () => {
      const workspace = ws({ rules: { cross_compound_imports: "unrestricted" } });

      const compoundA = lc(
        {
          compound: "a",
          imports: [], // no imports declared
          units: [{ role: "reaction", name: "DoStuff", file: "./reactions/DoStuff.ts" }],
        },
        "/project/compounds/a",
      );

      const compoundB = lc(
        {
          compound: "b",
          units: [{ role: "interface", name: "Repo", file: "./interfaces/Repo.ts" }],
        },
        "/project/compounds/b",
      );

      const reactionPath = "/project/compounds/a/reactions/DoStuff.ts";
      const internalPath = "/project/compounds/b/interfaces/Repo.ts";

      const importMap = new Map<string, ParsedImport[]>([
        [
          reactionPath,
          [{ moduleSpecifier: "../../b/interfaces/Repo", names: ["Repo"], isTypeOnly: false }],
        ],
        [internalPath, []],
      ]);

      const resolutions = new Map<string, string | undefined>([
        ["../../b/interfaces/Repo", internalPath],
      ]);

      const plugin = mockPlugin(importMap, resolutions);
      const diags = checkImports(workspace, [
        {
          plugin,
          scope: { id: "default", language: "typescript", paths: { compounds: "./src" } },
          compounds: [compoundA, compoundB],
        },
      ]);

      // No cross-compound diagnostics
      expect(diags.filter((d) => d.check === "import-undeclared")).toHaveLength(0);
      expect(diags.filter((d) => d.check === "import-bypass")).toHaveLength(0);
    });
  });
});
