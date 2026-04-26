/**
 * End-to-end test: Python workflow
 *
 * Full workflow: init --language python -> add compound -> add unit (all 6 roles)
 *   -> scaffold -> check -> analyze -> graph
 *
 * Gated behind `which python3` availability.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

// Gate: skip entire suite if python3 is not available
let hasPython3 = false;
try {
  execSync("python3 --version", { stdio: "pipe" });
  hasPython3 = true;
} catch {
  hasPython3 = false;
}

let tmpDir: string;
let originalCwd: string;

function runCmd(
  fn: (argv: string[]) => void,
  argv: string[],
): { exitCode: number | undefined; stdout: string[]; stderr: string[] } {
  const exitCode = { value: undefined as number | undefined };
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(((code?: number) => {
      exitCode.value = code;
      throw new Error(`process.exit(${code})`);
    }) as any);

  const logSpy = vi
    .spyOn(console, "log")
    .mockImplementation((...a: any[]) => {
      stdout.push(a.join(" "));
    });

  const errorSpy = vi
    .spyOn(console, "error")
    .mockImplementation((...a: any[]) => {
      stderr.push(a.join(" "));
    });

  const warnSpy = vi
    .spyOn(console, "warn")
    .mockImplementation((...a: any[]) => {
      stderr.push(a.join(" "));
    });

  try {
    fn(argv);
  } catch (e: any) {
    if (!e.message?.startsWith("process.exit")) throw e;
  }

  exitSpy.mockRestore();
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();

  return { exitCode: exitCode.value, stdout, stderr };
}

describe.skipIf(!hasPython3)("Python E2E workflow", () => {
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-e2e-py-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("step 1: init with --language python", async () => {
    const { cmdInit } = await import("../../src/commands/init.js");
    const result = runCmd(cmdInit, [
      "mypyapp",
      "--path",
      tmpDir,
      "--language",
      "python",
    ]);

    expect(result.exitCode).toBeUndefined();

    // workspace.yaml has language: python
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const wsContent = fs.readFileSync(wsPath, "utf-8");
    expect(wsContent).toContain("language: python");
    expect(wsContent).toContain("workspace: mypyapp");
    expect(wsContent).toContain("public_surface: __init__.py");

    // CLAUDE.md has Python content
    const claudeMd = fs.readFileSync(
      path.join(tmpDir, "CLAUDE.md"),
      "utf-8",
    );
    expect(claudeMd).toContain("__init__.py");
    expect(claudeMd).toContain("Language: Python");

    // Directory structure
    expect(fs.existsSync(path.join(tmpDir, "src/compounds"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "src/reagents"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "src/solvents"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "src/catalyst"))).toBe(true);
  });

  it("step 2: add compound", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, ["compound", "billing"]);

    expect(result.exitCode).toBeUndefined();

    const manifestPath = path.join(
      tmpDir,
      "src/compounds/billing/compound.yaml",
    );
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = parseYaml(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.compound).toBe("billing");
  });

  it("step 3: add unit — element (snake_case file)", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, [
      "unit",
      "billing",
      "element",
      "InvoiceId",
      "--export",
    ]);

    expect(result.exitCode).toBeUndefined();

    // File uses snake_case
    const stubPath = path.join(
      tmpDir,
      "src/compounds/billing/elements/invoice_id.py",
    );
    expect(fs.existsSync(stubPath)).toBe(true);

    const content = fs.readFileSync(stubPath, "utf-8");
    expect(content).toContain("class InvoiceId");
    expect(content).toContain("@dataclass(frozen=True)");

    // Manifest uses snake_case path
    const manifestPath = path.join(
      tmpDir,
      "src/compounds/billing/compound.yaml",
    );
    const manifest = parseYaml(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.units[0].file).toContain("elements/invoice_id.py");
  });

  it("step 4: add unit — molecule", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, [
      "unit",
      "billing",
      "molecule",
      "InvoiceDocument",
      "--export",
    ]);

    expect(result.exitCode).toBeUndefined();

    const stubPath = path.join(
      tmpDir,
      "src/compounds/billing/molecules/invoice_document.py",
    );
    expect(fs.existsSync(stubPath)).toBe(true);
    const content = fs.readFileSync(stubPath, "utf-8");
    expect(content).toContain("class InvoiceDocument");
    expect(content).toContain("@dataclass");
  });

  it("step 5: add unit — interface", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, [
      "unit",
      "billing",
      "interface",
      "InvoiceRepository",
      "--export",
    ]);

    expect(result.exitCode).toBeUndefined();

    const stubPath = path.join(
      tmpDir,
      "src/compounds/billing/interfaces/invoice_repository.py",
    );
    expect(fs.existsSync(stubPath)).toBe(true);
    const content = fs.readFileSync(stubPath, "utf-8");
    expect(content).toContain("class InvoiceRepository(ABC)");
    expect(content).toContain("@abstractmethod");
  });

  it("step 6: add unit — adapter", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, [
      "unit",
      "billing",
      "adapter",
      "PgInvoiceRepo",
      "--implements",
      "InvoiceRepository",
    ]);

    expect(result.exitCode).toBeUndefined();

    const stubPath = path.join(
      tmpDir,
      "src/compounds/billing/adapters/pg_invoice_repo.py",
    );
    expect(fs.existsSync(stubPath)).toBe(true);
    const content = fs.readFileSync(stubPath, "utf-8");
    expect(content).toContain("class PgInvoiceRepo");
  });

  it("step 7: add unit — reaction", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, [
      "unit",
      "billing",
      "reaction",
      "GenerateInvoice",
      "--export",
    ]);

    expect(result.exitCode).toBeUndefined();

    const stubPath = path.join(
      tmpDir,
      "src/compounds/billing/reactions/generate_invoice.py",
    );
    expect(fs.existsSync(stubPath)).toBe(true);
    const content = fs.readFileSync(stubPath, "utf-8");
    expect(content).toContain("async def generate_invoice");
  });

  it("step 8: add unit — buffer", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, [
      "unit",
      "billing",
      "buffer",
      "ValidateInvoice",
      "--export",
    ]);

    expect(result.exitCode).toBeUndefined();

    const stubPath = path.join(
      tmpDir,
      "src/compounds/billing/buffers/validate_invoice.py",
    );
    expect(fs.existsSync(stubPath)).toBe(true);
    const content = fs.readFileSync(stubPath, "utf-8");
    expect(content).toContain("def validate_invoice");
  });

  it("step 9: manifest has all 6 units with correct paths", () => {
    const manifestPath = path.join(
      tmpDir,
      "src/compounds/billing/compound.yaml",
    );
    const manifest = parseYaml(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.units).toHaveLength(6);

    const roles = manifest.units.map((u: any) => u.role).sort();
    expect(roles).toEqual([
      "adapter",
      "buffer",
      "element",
      "interface",
      "molecule",
      "reaction",
    ]);

    // All file paths use snake_case and .py extension
    for (const unit of manifest.units) {
      expect(unit.file).toMatch(/\.py$/);
      // File path (after role folder/) should be snake_case
      const filename = path.basename(unit.file);
      expect(filename).toMatch(/^[a-z_]+\.py$/);
    }
  });

  it("step 10: scaffold is a no-op for existing files", async () => {
    const { cmdScaffold } = await import("../../src/commands/scaffold.js");
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const result = runCmd(cmdScaffold, [wsPath]);

    expect(result.exitCode).toBeUndefined();
    const output = result.stdout.join("\n");
    expect(output).toContain("skipped");
  });

  it("step 11: __init__.py generated as public surface", async () => {
    // Generate __init__.py for the compound
    const { loadWorkspace, discoverCompounds } = await import(
      "@chemag/core/loader"
    );
    const { loadPlugin } = await import("../../src/plugin-loader.js");
    const ws = loadWorkspace(path.join(tmpDir, "workspace.yaml"));
    const compounds = discoverCompounds(ws, tmpDir);
    const plugin = loadPlugin({ language: "python" });

    const billingCompound = compounds.find(
      (c) => c.manifest.compound === "billing",
    )!;
    const content = plugin.generatePublicSurface(billingCompound, ws);
    const initPath = path.join(
      tmpDir,
      "src/compounds/billing/__init__.py",
    );
    fs.writeFileSync(initPath, content, "utf-8");

    expect(fs.existsSync(initPath)).toBe(true);
    const initContent = fs.readFileSync(initPath, "utf-8");
    expect(initContent).toContain("billing");
  });

  it("step 12: check passes with --manifest-only", async () => {
    const { cmdCheck } = await import("../../src/commands/check.js");
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const result = runCmd(cmdCheck, [wsPath, "--manifest-only"]);

    expect(result.exitCode).toBe(0);
    const output = result.stdout.join("\n");
    expect(output).toContain("passed");
  });

  it("step 13: check passes with filesystem checks", async () => {
    const { cmdCheck } = await import("../../src/commands/check.js");
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const result = runCmd(cmdCheck, [wsPath]);

    expect(result.exitCode).toBe(0);
  });

  it("step 14: analyze passes on clean stubs", async () => {
    const { cmdAnalyze } = await import("../../src/commands/analyze.js");
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const result = runCmd(cmdAnalyze, [wsPath]);

    // exit code 0 = no violations
    expect(result.exitCode).toBe(0);
    const output = result.stdout.join("\n");
    expect(output).toContain("All imports valid");
  });

  it("step 15: analyze detects bond violation in Python code", async () => {
    // Write a reaction that imports from an adapter (bond violation)
    const reactionPath = path.join(
      tmpDir,
      "src/compounds/billing/reactions/generate_invoice.py",
    );
    fs.writeFileSync(
      reactionPath,
      `"""GenerateInvoice — workflow."""

from ..adapters.pg_invoice_repo import PgInvoiceRepo


async def generate_invoice() -> None:
    repo = PgInvoiceRepo()
    raise NotImplementedError
`,
      "utf-8",
    );

    const { cmdAnalyze } = await import("../../src/commands/analyze.js");
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const result = runCmd(cmdAnalyze, [wsPath]);

    // Should fail with violations
    expect(result.exitCode).toBe(1);
    const output = result.stdout.join("\n");
    expect(output).toContain("violation");

    // Restore the clean stub
    fs.writeFileSync(
      reactionPath,
      `"""GenerateInvoice — workflow / use case."""


async def generate_invoice() -> None:
    """Execute the GenerateInvoice workflow.

    TODO: implement business logic.
    """
    raise NotImplementedError
`,
      "utf-8",
    );
  });

  it("step 16: graph produces Mermaid output", async () => {
    const { cmdGraph } = await import("../../src/commands/graph.js");
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const result = runCmd(cmdGraph, [wsPath]);

    expect(result.exitCode).toBeUndefined();
    const output = result.stdout.join("\n");
    expect(output).toContain("graph LR");
    expect(output).toContain("billing");
  });
});
