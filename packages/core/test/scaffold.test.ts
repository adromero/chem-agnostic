import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { scaffoldWorkspace } from "../src/scaffold.js";
import { typescriptPlugin } from "@chemag/plugin-typescript";
import type { Workspace, LoadedCompound } from "../src/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function minWs(): Workspace {
  return {
    workspace: "test",
    language: "typescript",
    roles: {
      element: { description: "Value", folder: "elements" },
      molecule: { description: "State", folder: "molecules" },
      reaction: { description: "Workflow", folder: "reactions" },
      interface: { description: "Contract", folder: "interfaces" },
      adapter: { description: "Impl", folder: "adapters" },
      buffer: { description: "MW", folder: "buffers" },
    },
    bonds: {
      element: ["element"],
      molecule: ["element", "molecule"],
      reaction: ["element", "molecule", "interface"],
      interface: ["element", "molecule"],
      adapter: ["element", "molecule", "interface", "adapter"],
      buffer: ["element", "molecule", "interface"],
    },
    paths: { compounds: "./src/compounds" },
    rules: { public_surface: "public.ts" },
  };
}

const plugin = typescriptPlugin;

describe("scaffoldWorkspace", () => {
  it("creates element stub with class", () => {
    const compoundDir = path.join(tmpDir, "reporting");
    fs.mkdirSync(compoundDir, { recursive: true });

    const compound: LoadedCompound = {
      dir: compoundDir,
      manifest: {
        compound: "reporting",
        units: [
          { role: "element", name: "ReportId", file: "./elements/ReportId.ts" },
        ],
      },
    };

    const result = scaffoldWorkspace(minWs(), [compound], plugin, false);
    expect(result.created).toHaveLength(1);

    const content = fs.readFileSync(
      path.join(compoundDir, "elements/ReportId.ts"),
      "utf-8",
    );
    expect(content).toContain("export class ReportId");
    expect(content).toContain("readonly value: string");
  });

  it("creates reaction stub with async function", () => {
    const compoundDir = path.join(tmpDir, "reporting");
    fs.mkdirSync(compoundDir, { recursive: true });

    const compound: LoadedCompound = {
      dir: compoundDir,
      manifest: {
        compound: "reporting",
        units: [
          {
            role: "reaction",
            name: "generateReport",
            file: "./reactions/generateReport.ts",
          },
        ],
      },
    };

    const result = scaffoldWorkspace(minWs(), [compound], plugin, false);
    const content = fs.readFileSync(
      path.join(compoundDir, "reactions/generateReport.ts"),
      "utf-8",
    );
    expect(content).toContain("export async function generateReport");
    expect(content).toContain("Promise<void>");
    expect(result.created).toHaveLength(1);
  });

  it("creates adapter stub with implements clause", () => {
    const compoundDir = path.join(tmpDir, "reporting");
    fs.mkdirSync(compoundDir, { recursive: true });

    const compound: LoadedCompound = {
      dir: compoundDir,
      manifest: {
        compound: "reporting",
        units: [
          {
            role: "interface",
            name: "Repo",
            file: "./interfaces/Repo.ts",
          },
          {
            role: "adapter",
            name: "PgRepo",
            file: "./adapters/PgRepo.ts",
            implements: ["Repo"],
          },
        ],
      },
    };

    scaffoldWorkspace(minWs(), [compound], plugin, false);
    const content = fs.readFileSync(
      path.join(compoundDir, "adapters/PgRepo.ts"),
      "utf-8",
    );
    expect(content).toContain("implements Repo");
    expect(content).toContain("import type { Repo }");
  });

  it("creates buffer stub with next parameter", () => {
    const compoundDir = path.join(tmpDir, "api");
    fs.mkdirSync(compoundDir, { recursive: true });

    const compound: LoadedCompound = {
      dir: compoundDir,
      manifest: {
        compound: "api",
        units: [
          { role: "buffer", name: "auth", file: "./buffers/auth.ts" },
        ],
      },
    };

    scaffoldWorkspace(minWs(), [compound], plugin, false);
    const content = fs.readFileSync(
      path.join(compoundDir, "buffers/auth.ts"),
      "utf-8",
    );
    expect(content).toContain("export function auth");
    expect(content).toContain("next");
  });

  it("generates public.ts for compounds with exports", () => {
    const compoundDir = path.join(tmpDir, "reporting");
    fs.mkdirSync(compoundDir, { recursive: true });

    const compound: LoadedCompound = {
      dir: compoundDir,
      manifest: {
        compound: "reporting",
        exports: { elements: ["ReportId"], interfaces: ["Repo"] },
        units: [
          { role: "element", name: "ReportId", file: "./elements/ReportId.ts" },
          { role: "interface", name: "Repo", file: "./interfaces/Repo.ts" },
        ],
      },
    };

    scaffoldWorkspace(minWs(), [compound], plugin, false);
    const content = fs.readFileSync(
      path.join(compoundDir, "public.ts"),
      "utf-8",
    );
    expect(content).toContain('export { ReportId } from "./elements/ReportId"');
    expect(content).toContain('export type { Repo } from "./interfaces/Repo"');
  });

  it("generates assay stubs with subject imports", () => {
    const compoundDir = path.join(tmpDir, "reporting");
    fs.mkdirSync(compoundDir, { recursive: true });

    const compound: LoadedCompound = {
      dir: compoundDir,
      manifest: {
        compound: "reporting",
        units: [
          { role: "element", name: "ReportId", file: "./elements/ReportId.ts" },
        ],
        assays: [
          {
            name: "ReportId.test",
            file: "./assays/ReportId.test.ts",
            subjects: ["ReportId"],
          },
        ],
      },
    };

    scaffoldWorkspace(minWs(), [compound], plugin, false);
    const content = fs.readFileSync(
      path.join(compoundDir, "assays/ReportId.test.ts"),
      "utf-8",
    );
    expect(content).toContain("import { ReportId }");
    expect(content).toContain("describe");
  });

  it("skips existing files", () => {
    const compoundDir = path.join(tmpDir, "reporting");
    const elemDir = path.join(compoundDir, "elements");
    fs.mkdirSync(elemDir, { recursive: true });
    fs.writeFileSync(path.join(elemDir, "ReportId.ts"), "existing", "utf-8");

    const compound: LoadedCompound = {
      dir: compoundDir,
      manifest: {
        compound: "reporting",
        units: [
          { role: "element", name: "ReportId", file: "./elements/ReportId.ts" },
        ],
      },
    };

    const result = scaffoldWorkspace(minWs(), [compound], plugin, false);
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);

    // Content should be untouched
    const content = fs.readFileSync(
      path.join(elemDir, "ReportId.ts"),
      "utf-8",
    );
    expect(content).toBe("existing");
  });

  it("dry-run creates nothing", () => {
    const compoundDir = path.join(tmpDir, "reporting");
    fs.mkdirSync(compoundDir, { recursive: true });

    const compound: LoadedCompound = {
      dir: compoundDir,
      manifest: {
        compound: "reporting",
        units: [
          { role: "element", name: "X", file: "./elements/X.ts" },
        ],
      },
    };

    const result = scaffoldWorkspace(minWs(), [compound], plugin, true);
    expect(result.created).toHaveLength(1);
    expect(fs.existsSync(path.join(compoundDir, "elements/X.ts"))).toBe(false);
  });

  it("resolves cross-compound imports through public surface", () => {
    const compoundA = path.join(tmpDir, "a");
    const compoundB = path.join(tmpDir, "b");
    fs.mkdirSync(compoundA, { recursive: true });
    fs.mkdirSync(compoundB, { recursive: true });

    const a: LoadedCompound = {
      dir: compoundA,
      manifest: {
        compound: "a",
        exports: { elements: ["UserId"] },
        units: [
          { role: "element", name: "UserId", file: "./elements/UserId.ts" },
        ],
      },
    };

    const b: LoadedCompound = {
      dir: compoundB,
      manifest: {
        compound: "b",
        imports: [{ compound: "a" }],
        units: [
          {
            role: "molecule",
            name: "Profile",
            file: "./molecules/Profile.ts",
            depends_on: ["UserId"],
          },
        ],
      },
    };

    scaffoldWorkspace(minWs(), [a, b], plugin, false);
    const content = fs.readFileSync(
      path.join(compoundB, "molecules/Profile.ts"),
      "utf-8",
    );
    expect(content).toContain("import { UserId }");
    expect(content).toContain("/a/public");
  });
});
