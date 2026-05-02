// ---------------------------------------------------------------------------
// Unit tests for `addUnitToCompound` — the language-agnostic helper extracted
// from `packages/cli/src/commands/add.ts` in wp-015.
//
// Coverage:
//   * happy path — manifest patched, stub created
//   * --export — exports list created and appended
//   * --implements — `implements: [name]` appended to the unit entry
//   * unknown role -> UnknownRoleError
//   * missing compound -> CompoundNotFoundError
//   * duplicate unit name -> DuplicateUnitError
//   * dryRun — manifest on disk untouched, stub not created
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify } from "yaml";
import { loadWorkspace } from "../src/loader.js";
import {
  addUnitToCompound,
  CompoundNotFoundError,
  DuplicateUnitError,
  UnknownRoleError,
} from "../src/add-unit.js";
import type { LanguagePlugin } from "../src/plugin-interface.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-add-unit-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Tiny test plugin — just enough surface for `addUnitToCompound` to call
 * `unitFilePath` and for `scaffoldWorkspace` to emit a stub file.
 */
function makePlugin(): LanguagePlugin {
  return {
    name: "tslike",
    fileExtensions: [".ts"],
    defaults: {
      publicSurface: "public.ts",
      testFilePattern: /\.test\.ts$/,
      testFrameworkImport: "vitest",
    },
    parseImports: () => [],
    parseImportsBatch: () => new Map(),
    resolveModulePath: () => undefined,
    generateUnitStub: (unit) => `// stub ${unit.role} ${unit.name}\n`,
    generatePublicSurface: () => "// surface\n",
    generateAssayStub: () => "// assay stub\n",
    unitFilePath: (_role, name, folder) => `${folder}/${name}.ts`,
    formatRelativeImport: (_from, to) => to,
    formatImportStatement: () => "",
    inferUnits: () => [],
    inferImplements: () => [],
    isSourceFile: (n) => n.endsWith(".ts"),
    generateClaudeMd: () => "",
  };
}

function writeWorkspace(): { wsPath: string; wsDir: string } {
  const ws = {
    workspace: "testws",
    language: "typescript",
    roles: {
      element: { description: "V", folder: "elements" },
      molecule: { description: "S", folder: "molecules" },
      reaction: { description: "W", folder: "reactions" },
      interface: { description: "C", folder: "interfaces" },
      adapter: { description: "I", folder: "adapters" },
      buffer: { description: "M", folder: "buffers" },
    },
    bonds: {
      element: ["element"],
      molecule: ["element", "molecule"],
      reaction: ["element", "molecule", "interface"],
      interface: ["element", "molecule"],
      adapter: ["element", "molecule", "interface", "adapter"],
      buffer: ["element", "molecule", "interface"],
    },
    paths: {
      compounds: "./src/compounds",
    },
    rules: {
      cross_compound_imports: "public_only" as const,
      role_from_path: true,
      public_surface: "public.ts",
      manifest_filename: "compound.yaml",
    },
  };
  const wsPath = path.join(tmpDir, "workspace.yaml");
  fs.writeFileSync(wsPath, stringify(ws, { lineWidth: 100 }), "utf-8");
  return { wsPath, wsDir: tmpDir };
}

function writeCompound(name: string, manifest: Record<string, unknown>): string {
  const dir = path.join(tmpDir, "src/compounds", name);
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, "compound.yaml");
  fs.writeFileSync(manifestPath, stringify(manifest, { lineWidth: 100 }), "utf-8");
  return dir;
}

describe("addUnitToCompound — happy path", () => {
  it("appends a unit, persists the manifest, and scaffolds the stub", () => {
    const { wsPath, wsDir } = writeWorkspace();
    writeCompound("reporting", {
      compound: "reporting",
      exports: {},
      imports: [],
      units: [],
      assays: [],
    });
    const ws = loadWorkspace(wsPath);

    const result = addUnitToCompound({
      workspace: ws,
      workspaceDir: wsDir,
      compoundName: "reporting",
      role: "element",
      unitName: "ReportId",
      plugin: makePlugin(),
    });

    expect(result.manifestBefore).not.toContain("ReportId");
    expect(result.manifestAfter).toContain("name: ReportId");
    expect(result.manifestAfter).toContain("elements/ReportId.ts");

    const onDisk = fs.readFileSync(result.manifestPath, "utf-8");
    expect(onDisk).toBe(result.manifestAfter);

    expect(result.created.length).toBeGreaterThanOrEqual(1);
    expect(result.created.some((p) => p.endsWith(`elements${path.sep}ReportId.ts`))).toBe(true);
    expect(fs.existsSync(path.join(wsDir, "src/compounds/reporting/elements/ReportId.ts"))).toBe(
      true,
    );
  });

  it("--export creates the exports map and appends the unit name", () => {
    const { wsPath, wsDir } = writeWorkspace();
    writeCompound("reporting", {
      compound: "reporting",
      exports: {},
      imports: [],
      units: [],
      assays: [],
    });
    const ws = loadWorkspace(wsPath);

    const result = addUnitToCompound({
      workspace: ws,
      workspaceDir: wsDir,
      compoundName: "reporting",
      role: "element",
      unitName: "ReportId",
      export: true,
      plugin: makePlugin(),
    });

    expect(result.manifestAfter).toContain("elements:");
    // YAML may emit either `[ ReportId ]` (flow) or `\n  - ReportId` (block).
    expect(result.manifestAfter).toMatch(/elements:\s*(\[\s*ReportId\s*\]|\n\s*-\s*ReportId)/);
  });

  it("--implements appends the implements list to the unit entry (adapter)", () => {
    const { wsPath, wsDir } = writeWorkspace();
    writeCompound("reporting", {
      compound: "reporting",
      exports: {},
      imports: [],
      units: [{ role: "interface", name: "Repo", file: "./interfaces/Repo.ts" }],
      assays: [],
    });
    const ws = loadWorkspace(wsPath);

    const result = addUnitToCompound({
      workspace: ws,
      workspaceDir: wsDir,
      compoundName: "reporting",
      role: "adapter",
      unitName: "PgRepo",
      implementsSymbol: "Repo",
      plugin: makePlugin(),
    });

    expect(result.manifestAfter).toContain("name: PgRepo");
    expect(result.manifestAfter).toContain("implements:");
    // YAML's flow form may write `implements: [Repo]` or block form with `- Repo`.
    expect(result.manifestAfter).toMatch(/implements:\s*(\[Repo\]|\n\s*-\s*Repo)/);
  });
});

describe("addUnitToCompound — typed errors", () => {
  it("throws UnknownRoleError when the role is not in workspace.roles", () => {
    const { wsPath, wsDir } = writeWorkspace();
    writeCompound("reporting", { compound: "reporting", units: [] });
    const ws = loadWorkspace(wsPath);

    expect(() =>
      addUnitToCompound({
        workspace: ws,
        workspaceDir: wsDir,
        compoundName: "reporting",
        role: "bogus",
        unitName: "X",
        plugin: makePlugin(),
      }),
    ).toThrow(UnknownRoleError);
  });

  it("throws CompoundNotFoundError when the compound does not exist", () => {
    const { wsPath, wsDir } = writeWorkspace();
    const ws = loadWorkspace(wsPath);

    expect(() =>
      addUnitToCompound({
        workspace: ws,
        workspaceDir: wsDir,
        compoundName: "ghost",
        role: "element",
        unitName: "X",
        plugin: makePlugin(),
      }),
    ).toThrow(CompoundNotFoundError);
  });

  it("throws DuplicateUnitError when the unit name already exists", () => {
    const { wsPath, wsDir } = writeWorkspace();
    writeCompound("reporting", {
      compound: "reporting",
      units: [{ role: "element", name: "ReportId", file: "./elements/ReportId.ts" }],
    });
    const ws = loadWorkspace(wsPath);

    expect(() =>
      addUnitToCompound({
        workspace: ws,
        workspaceDir: wsDir,
        compoundName: "reporting",
        role: "element",
        unitName: "ReportId",
        plugin: makePlugin(),
      }),
    ).toThrow(DuplicateUnitError);
  });
});

describe("addUnitToCompound — dryRun", () => {
  it("computes manifestAfter in memory but writes nothing to disk", () => {
    const { wsPath, wsDir } = writeWorkspace();
    writeCompound("reporting", {
      compound: "reporting",
      exports: {},
      imports: [],
      units: [],
      assays: [],
    });
    const ws = loadWorkspace(wsPath);

    const result = addUnitToCompound({
      workspace: ws,
      workspaceDir: wsDir,
      compoundName: "reporting",
      role: "element",
      unitName: "ReportId",
      plugin: makePlugin(),
      dryRun: true,
    });

    expect(result.manifestAfter).toContain("name: ReportId");
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([]);

    // On-disk manifest must equal manifestBefore (NOT manifestAfter).
    const onDisk = fs.readFileSync(result.manifestPath, "utf-8");
    expect(onDisk).toBe(result.manifestBefore);
    expect(onDisk).not.toContain("ReportId");

    // Stub file was NOT created.
    expect(fs.existsSync(path.join(wsDir, "src/compounds/reporting/elements/ReportId.ts"))).toBe(
      false,
    );
  });
});
