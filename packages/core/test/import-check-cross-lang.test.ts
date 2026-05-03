// ---------------------------------------------------------------------------
// wp-020 — cross-language import detection in checkImports.
//
// Exercises:
//   1. Cross-sub-tree imports flagged with CHEM-IMPORT-CROSS-LANG-001 and
//      tagged with the source sub-tree's language_id.
//   2. allowed_cross_language_imports allow-listing suppresses the diagnostic.
//   3. Per-sub-tree plugin selection — the hook is invoked once per sub-tree
//      with the matching plugin and scope arguments.
//   4. Within-sub-tree imports continue to apply bond + cross-compound rules.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { checkImports, type ImportCheckScope } from "../src/import-check.js";
import type { LoadedCompound, ParsedImport, Workspace } from "../src/types.js";
import type { LanguagePlugin } from "../src/plugin-interface.js";

function ws(overrides?: Partial<Workspace>): Workspace {
  return {
    workspace: "multi",
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
    paths: { compounds: "./apps/web/compounds" },
    rules: { cross_compound_imports: "public_only", public_surface: "public.ts" },
    ...overrides,
  };
}

function lc(manifest: LoadedCompound["manifest"], dir: string): LoadedCompound {
  return { manifest, dir };
}

interface MockPluginCallLog {
  /** Number of parseImportsBatch calls observed. */
  calls: { paths: string[] }[];
}

function mockPlugin(
  name: string,
  importMap: Map<string, ParsedImport[]>,
  resolutions: Map<string, string | undefined>,
  log?: MockPluginCallLog,
): LanguagePlugin {
  return {
    name,
    fileExtensions: [".ts"],
    defaults: {
      publicSurface: "public.ts",
      testFilePattern: /\.test\.ts$/,
      testFrameworkImport: "vitest",
    },
    parseImportsBatch(paths: string[]): Map<string, ParsedImport[]> {
      log?.calls.push({ paths });
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
// Fixtures: 2-sub-tree workspace (TS + Python). Source file in the TS
// sub-tree imports a compound that lives in the Python sub-tree.
// ---------------------------------------------------------------------------
function buildCrossLangScenario() {
  const tsCompound = lc(
    {
      compound: "web_orders",
      imports: [],
      units: [{ role: "reaction", name: "DoStuff", file: "./reactions/DoStuff.ts" }],
    },
    "/project/apps/web/compounds/web_orders",
  );
  const pyCompound = lc(
    {
      compound: "api_orders",
      units: [{ role: "interface", name: "Repo", file: "./interfaces/Repo.py" }],
    },
    "/project/apps/api/compounds/api_orders",
  );

  const tsReactionPath = "/project/apps/web/compounds/web_orders/reactions/DoStuff.ts";
  const pyInterfacePath = "/project/apps/api/compounds/api_orders/interfaces/Repo.py";

  // The TS plugin happens to resolve the import to the Python file
  // (the plugin doesn't know about language boundaries; resolveModulePath
  // returns whatever the chem unit table tells it to return).
  const tsImports = new Map<string, ParsedImport[]>([
    [
      tsReactionPath,
      [
        {
          moduleSpecifier: "../../../../api/compounds/api_orders/interfaces/Repo",
          names: ["Repo"],
          isTypeOnly: false,
        },
      ],
    ],
  ]);
  const tsResolutions = new Map<string, string | undefined>([
    ["../../../../api/compounds/api_orders/interfaces/Repo", pyInterfacePath],
  ]);

  const tsLog: MockPluginCallLog = { calls: [] };
  const pyLog: MockPluginCallLog = { calls: [] };
  const tsPlugin = mockPlugin("typescript", tsImports, tsResolutions, tsLog);
  const pyPlugin = mockPlugin("python", new Map(), new Map(), pyLog);

  return { tsCompound, pyCompound, tsPlugin, pyPlugin, tsLog, pyLog };
}

describe("checkImports — wp-020 cross-language detection", () => {
  it("emits CHEM-IMPORT-CROSS-LANG-001 with the source sub-tree's language_id", () => {
    const { tsCompound, pyCompound, tsPlugin, pyPlugin } = buildCrossLangScenario();

    const scopes: ImportCheckScope[] = [
      {
        plugin: tsPlugin,
        scope: { id: "web", language: "typescript", paths: { compounds: "./apps/web/compounds" } },
        compounds: [tsCompound],
      },
      {
        plugin: pyPlugin,
        scope: { id: "api", language: "python", paths: { compounds: "./apps/api/compounds" } },
        compounds: [pyCompound],
      },
    ];

    const diags = checkImports(ws(), scopes);
    const xlang = diags.find((d) => d.code === "CHEM-IMPORT-CROSS-LANG-001");
    expect(xlang).toBeDefined();
    expect(xlang!.level).toBe("error");
    expect(xlang!.language_id).toBe("web");
    expect(xlang!.message).toContain("web");
    expect(xlang!.message).toContain("api");
    expect(xlang!.message).toContain("api_orders");

    // The cross-language diagnostic short-circuits the per-sub-tree
    // bond / cross-compound checks for the same import — we don't expect
    // an "import-undeclared" / "import-bypass" alongside it.
    expect(diags.find((d) => d.code === "CHEM-IMPORT-003")).toBeUndefined();
    expect(diags.find((d) => d.code === "CHEM-IMPORT-004")).toBeUndefined();
  });

  it("does NOT emit the diagnostic when the source sub-tree allow-lists the target", () => {
    const { tsCompound, pyCompound, tsPlugin, pyPlugin } = buildCrossLangScenario();

    const scopes: ImportCheckScope[] = [
      {
        plugin: tsPlugin,
        scope: {
          id: "web",
          language: "typescript",
          paths: { compounds: "./apps/web/compounds" },
          allowed_cross_language_imports: ["api"],
        },
        compounds: [tsCompound],
      },
      {
        plugin: pyPlugin,
        scope: { id: "api", language: "python", paths: { compounds: "./apps/api/compounds" } },
        compounds: [pyCompound],
      },
    ];

    const diags = checkImports(ws(), scopes);
    expect(diags.find((d) => d.code === "CHEM-IMPORT-CROSS-LANG-001")).toBeUndefined();
    // The allow-list opens up the standard rule path; the import lands on
    // an internal file (Repo.py, not the python public surface) and the
    // source compound never declares api_orders, so the regular
    // import-undeclared diagnostic fires INSTEAD of the cross-lang one.
    const undeclared = diags.find((d) => d.code === "CHEM-IMPORT-003");
    expect(undeclared).toBeDefined();
    expect(undeclared!.language_id).toBe("web");
  });

  it("invokes the parseImportsBatch hook once per sub-tree with the correct scope", () => {
    const { tsCompound, pyCompound, tsPlugin, pyPlugin } = buildCrossLangScenario();

    const hookCalls: { plugin: string; scopeId: string; paths: string[] }[] = [];

    const scopes: ImportCheckScope[] = [
      {
        plugin: tsPlugin,
        scope: { id: "web", language: "typescript", paths: { compounds: "./apps/web/compounds" } },
        compounds: [tsCompound],
      },
      {
        plugin: pyPlugin,
        scope: { id: "api", language: "python", paths: { compounds: "./apps/api/compounds" } },
        compounds: [pyCompound],
      },
    ];

    checkImports(ws(), scopes, {
      parseImportsBatch: (paths, plugin, scope) => {
        hookCalls.push({ plugin: plugin.name, scopeId: scope.id, paths });
        // Delegate to the plugin so the rest of the orchestrator still gets
        // real ParsedImport[] entries — proves the hook signature can be a
        // thin pass-through over the plugin (mirrors the CLI cache-aware
        // implementation).
        return plugin.parseImportsBatch(paths);
      },
    });

    expect(hookCalls).toHaveLength(2);
    const web = hookCalls.find((h) => h.scopeId === "web");
    const api = hookCalls.find((h) => h.scopeId === "api");
    expect(web).toBeDefined();
    expect(api).toBeDefined();
    expect(web!.plugin).toBe("typescript");
    expect(api!.plugin).toBe("python");
    // Each sub-tree only sees its OWN files in the batch — no leakage.
    expect(web!.paths).toEqual(["/project/apps/web/compounds/web_orders/reactions/DoStuff.ts"]);
    expect(api!.paths).toEqual(["/project/apps/api/compounds/api_orders/interfaces/Repo.py"]);
  });

  it("uses the matching sub-tree's plugin to parse each sub-tree's source files", () => {
    const { tsCompound, pyCompound, tsPlugin, pyPlugin, tsLog, pyLog } = buildCrossLangScenario();

    const scopes: ImportCheckScope[] = [
      {
        plugin: tsPlugin,
        scope: { id: "web", language: "typescript", paths: { compounds: "./apps/web/compounds" } },
        compounds: [tsCompound],
      },
      {
        plugin: pyPlugin,
        scope: { id: "api", language: "python", paths: { compounds: "./apps/api/compounds" } },
        compounds: [pyCompound],
      },
    ];

    checkImports(ws(), scopes); // no hook → plugins are called directly

    expect(tsLog.calls).toHaveLength(1);
    expect(pyLog.calls).toHaveLength(1);
    expect(tsLog.calls[0].paths).toEqual([
      "/project/apps/web/compounds/web_orders/reactions/DoStuff.ts",
    ]);
    expect(pyLog.calls[0].paths).toEqual([
      "/project/apps/api/compounds/api_orders/interfaces/Repo.py",
    ]);
  });

  it("preserves single-sub-tree behaviour when only one scope is supplied", () => {
    // Within a single sub-tree, importing across compound boundaries through
    // the public surface is fine; no cross-language diagnostic should fire
    // because both source and target share the same subtreeId.
    const a = lc(
      {
        compound: "a",
        imports: [{ compound: "b" }],
        units: [{ role: "reaction", name: "DoStuff", file: "./reactions/DoStuff.ts" }],
      },
      "/project/compounds/a",
    );
    const b = lc(
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
    ]);
    const resolutions = new Map<string, string | undefined>([["../../b/public", publicPath]]);
    const plugin = mockPlugin("typescript", importMap, resolutions);

    const diags = checkImports(ws(), [
      {
        plugin,
        scope: { id: "default", language: "typescript", paths: { compounds: "./compounds" } },
        compounds: [a, b],
      },
    ]);

    expect(diags.find((d) => d.code === "CHEM-IMPORT-CROSS-LANG-001")).toBeUndefined();
  });
});
