import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { stringify } from "yaml";

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-add-test-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Write a minimal workspace.yaml to tmpDir. */
function writeWorkspace(language: string): string {
  const publicSurface = language === "python" ? "__init__.py" : "public.ts";
  const ws = {
    workspace: "testws",
    language,
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
    paths: {
      compounds: "./src/compounds",
      reagents: "./src/reagents",
      solvents: "./src/solvents",
      catalyst: "./src/catalyst",
    },
    rules: {
      cross_compound_imports: "public_only",
      role_from_path: true,
      public_surface: publicSurface,
      manifest_filename: "compound.yaml",
    },
  };

  const wsPath = path.join(tmpDir, "workspace.yaml");
  fs.writeFileSync(wsPath, stringify(ws, { lineWidth: 100 }), "utf-8");
  return wsPath;
}

/** Write a compound manifest in the standard location. */
function writeCompound(
  name: string,
  manifest: Record<string, unknown>,
): string {
  const compoundDir = path.join(tmpDir, "src/compounds", name);
  fs.mkdirSync(compoundDir, { recursive: true });
  const manifestPath = path.join(compoundDir, "compound.yaml");
  fs.writeFileSync(manifestPath, stringify(manifest, { lineWidth: 100 }), "utf-8");
  return compoundDir;
}

async function runAdd(args: string[]): Promise<{
  exitCode: number | undefined;
  stderr: string[];
  stdout: string[];
}> {
  const exitCode = { value: undefined as number | undefined };
  const stderr: string[] = [];
  const stdout: string[] = [];

  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode.value = code;
    throw new Error(`process.exit(${code})`);
  }) as any);

  vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
    stderr.push(args.join(" "));
  });

  vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
    stdout.push(args.join(" "));
  });

  const { cmdAdd } = await import("../src/commands/add.js");

  try {
    cmdAdd(args);
  } catch (e: any) {
    if (!e.message?.startsWith("process.exit")) throw e;
  }

  vi.restoreAllMocks();

  return { exitCode: exitCode.value, stderr, stdout };
}

describe("cmdAdd compound", () => {
  it("creates a compound directory and manifest", async () => {
    writeWorkspace("typescript");
    fs.mkdirSync(path.join(tmpDir, "src/compounds"), { recursive: true });

    await runAdd(["compound", "payments"]);

    const manifestPath = path.join(
      tmpDir,
      "src/compounds/payments/compound.yaml",
    );
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = fs.readFileSync(manifestPath, "utf-8");
    expect(content).toContain("compound: payments");
  });
});

describe("cmdAdd unit — TypeScript", () => {
  it("adds a unit with .ts extension", async () => {
    writeWorkspace("typescript");
    writeCompound("reporting", {
      compound: "reporting",
      exports: {},
      imports: [],
      units: [],
      assays: [],
    });

    await runAdd(["unit", "reporting", "element", "ReportId"]);

    // Check the manifest was updated
    const manifestPath = path.join(
      tmpDir,
      "src/compounds/reporting/compound.yaml",
    );
    const content = fs.readFileSync(manifestPath, "utf-8");
    expect(content).toContain("name: ReportId");
    expect(content).toContain("elements/ReportId.ts");

    // Check the stub file was created
    const stubPath = path.join(
      tmpDir,
      "src/compounds/reporting/elements/ReportId.ts",
    );
    expect(fs.existsSync(stubPath)).toBe(true);
  });

  it("adds a unit with --export flag", async () => {
    writeWorkspace("typescript");
    writeCompound("reporting", {
      compound: "reporting",
      exports: {},
      imports: [],
      units: [],
      assays: [],
    });

    await runAdd(["unit", "reporting", "element", "ReportId", "--export"]);

    const manifestPath = path.join(
      tmpDir,
      "src/compounds/reporting/compound.yaml",
    );
    const content = fs.readFileSync(manifestPath, "utf-8");
    expect(content).toContain("elements:");
    expect(content).toContain("ReportId");
  });

  it("adds an adapter with --implements flag", async () => {
    writeWorkspace("typescript");
    writeCompound("reporting", {
      compound: "reporting",
      exports: {},
      imports: [],
      units: [
        { role: "interface", name: "Repo", file: "./interfaces/Repo.ts" },
      ],
      assays: [],
    });

    await runAdd([
      "unit",
      "reporting",
      "adapter",
      "PgRepo",
      "--implements",
      "Repo",
    ]);

    const manifestPath = path.join(
      tmpDir,
      "src/compounds/reporting/compound.yaml",
    );
    const content = fs.readFileSync(manifestPath, "utf-8");
    expect(content).toContain("name: PgRepo");
    expect(content).toContain("adapters/PgRepo.ts");
    expect(content).toContain("implements:");
    expect(content).toContain("Repo");
  });
});

describe("cmdAdd unit — Python", () => {
  it("adds a unit with .py extension and snake_case filename", async () => {
    writeWorkspace("python");
    writeCompound("reporting", {
      compound: "reporting",
      exports: {},
      imports: [],
      units: [],
      assays: [],
    });

    await runAdd(["unit", "reporting", "element", "ReportId"]);

    // Check the manifest was updated with .py path
    const manifestPath = path.join(
      tmpDir,
      "src/compounds/reporting/compound.yaml",
    );
    const content = fs.readFileSync(manifestPath, "utf-8");
    expect(content).toContain("name: ReportId");
    expect(content).toContain("elements/report_id.py");

    // Check the stub file was created with snake_case name
    const stubPath = path.join(
      tmpDir,
      "src/compounds/reporting/elements/report_id.py",
    );
    expect(fs.existsSync(stubPath)).toBe(true);
  });

  it("adds a reaction with snake_case filename", async () => {
    writeWorkspace("python");
    writeCompound("reporting", {
      compound: "reporting",
      exports: {},
      imports: [],
      units: [],
      assays: [],
    });

    await runAdd(["unit", "reporting", "reaction", "GenerateReport"]);

    const manifestPath = path.join(
      tmpDir,
      "src/compounds/reporting/compound.yaml",
    );
    const content = fs.readFileSync(manifestPath, "utf-8");
    expect(content).toContain("reactions/generate_report.py");
  });
});

describe("cmdAdd error cases", () => {
  it("fails for unknown role", async () => {
    writeWorkspace("typescript");
    writeCompound("reporting", {
      compound: "reporting",
      units: [],
    });

    const { exitCode, stderr } = await runAdd([
      "unit",
      "reporting",
      "unknownrole",
      "Foo",
    ]);
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain("Unknown role");
  });

  it("fails for unknown compound", async () => {
    writeWorkspace("typescript");

    const { exitCode, stderr } = await runAdd([
      "unit",
      "nonexistent",
      "element",
      "Foo",
    ]);
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain("not found");
  });

  it("fails for duplicate unit", async () => {
    writeWorkspace("typescript");
    writeCompound("reporting", {
      compound: "reporting",
      units: [
        { role: "element", name: "ReportId", file: "./elements/ReportId.ts" },
      ],
    });

    const { exitCode, stderr } = await runAdd([
      "unit",
      "reporting",
      "element",
      "ReportId",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("already exists");
  });
});
