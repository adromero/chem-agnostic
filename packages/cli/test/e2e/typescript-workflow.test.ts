/**
 * End-to-end test: TypeScript workflow
 *
 * Full workflow: init -> add compound -> add unit (all 6 roles)
 *   -> scaffold -> check -> analyze -> graph
 *
 * This exercises the entire pipeline on a real temp directory,
 * using the actual command functions. process.exit() is mocked
 * so assertions can inspect the results.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";

let tmpDir: string;
let originalCwd: string;

// Capture stdout/stderr/exit across command invocations
function runCmd(
  fn: (argv: string[]) => void,
  argv: string[],
): { exitCode: number | undefined; stdout: string[]; stderr: string[] } {
  const exitCode = { value: undefined as number | undefined };
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode.value = code;
    throw new Error(`process.exit(${code})`);
  }) as any);

  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: any[]) => {
    stdout.push(a.join(" "));
  });

  const errorSpy = vi.spyOn(console, "error").mockImplementation((...a: any[]) => {
    stderr.push(a.join(" "));
  });

  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a: any[]) => {
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

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-e2e-ts-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("TypeScript E2E workflow", () => {
  it("step 1: init creates workspace.yaml, CLAUDE.md, and directories", async () => {
    const { cmdInit } = await import("../../src/commands/init.js");
    const result = runCmd(cmdInit, ["mytsapp", "--path", tmpDir, "--language", "typescript"]);

    // Should not exit with error
    expect(result.exitCode).toBeUndefined();

    // workspace.yaml exists with correct fields
    const wsPath = path.join(tmpDir, "workspace.yaml");
    expect(fs.existsSync(wsPath)).toBe(true);
    const wsContent = fs.readFileSync(wsPath, "utf-8");
    expect(wsContent).toContain("workspace: mytsapp");
    expect(wsContent).toContain("language: typescript");
    expect(wsContent).toContain("public_surface: public.ts");

    // CLAUDE.md exists
    expect(fs.existsSync(path.join(tmpDir, "CLAUDE.md"))).toBe(true);

    // Directories exist
    expect(fs.existsSync(path.join(tmpDir, "src/compounds"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "src/reagents"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "src/solvents"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "src/catalyst"))).toBe(true);
  });

  it("step 2: add compound creates directory and manifest", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, ["compound", "payments"]);

    expect(result.exitCode).toBeUndefined();

    const manifestPath = path.join(tmpDir, "src/compounds/payments/compound.yaml");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = parseYaml(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.compound).toBe("payments");
  });

  it("step 3: add unit — element", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, ["unit", "payments", "element", "PaymentId", "--export"]);

    expect(result.exitCode).toBeUndefined();

    // Manifest updated
    const manifestPath = path.join(tmpDir, "src/compounds/payments/compound.yaml");
    const manifest = parseYaml(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.units).toHaveLength(1);
    expect(manifest.units[0].role).toBe("element");
    expect(manifest.units[0].name).toBe("PaymentId");
    expect(manifest.units[0].file).toContain("elements/PaymentId.ts");

    // Stub file created
    const stubPath = path.join(tmpDir, "src/compounds/payments/elements/PaymentId.ts");
    expect(fs.existsSync(stubPath)).toBe(true);
    const content = fs.readFileSync(stubPath, "utf-8");
    expect(content).toContain("export class PaymentId");
  });

  it("step 4: add unit — molecule", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, ["unit", "payments", "molecule", "PaymentOrder", "--export"]);

    expect(result.exitCode).toBeUndefined();

    const stubPath = path.join(tmpDir, "src/compounds/payments/molecules/PaymentOrder.ts");
    expect(fs.existsSync(stubPath)).toBe(true);
    const content = fs.readFileSync(stubPath, "utf-8");
    expect(content).toContain("export class PaymentOrder");
  });

  it("step 5: add unit — interface", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, ["unit", "payments", "interface", "PaymentGateway", "--export"]);

    expect(result.exitCode).toBeUndefined();

    const stubPath = path.join(tmpDir, "src/compounds/payments/interfaces/PaymentGateway.ts");
    expect(fs.existsSync(stubPath)).toBe(true);
    const content = fs.readFileSync(stubPath, "utf-8");
    expect(content).toContain("export interface PaymentGateway");
  });

  it("step 6: add unit — adapter", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, [
      "unit",
      "payments",
      "adapter",
      "StripeGateway",
      "--implements",
      "PaymentGateway",
    ]);

    expect(result.exitCode).toBeUndefined();

    const stubPath = path.join(tmpDir, "src/compounds/payments/adapters/StripeGateway.ts");
    expect(fs.existsSync(stubPath)).toBe(true);
    const content = fs.readFileSync(stubPath, "utf-8");
    expect(content).toContain("export class StripeGateway");
    expect(content).toContain("implements PaymentGateway");
  });

  it("step 7: add unit — reaction", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, ["unit", "payments", "reaction", "processPayment", "--export"]);

    expect(result.exitCode).toBeUndefined();

    const stubPath = path.join(tmpDir, "src/compounds/payments/reactions/processPayment.ts");
    expect(fs.existsSync(stubPath)).toBe(true);
    const content = fs.readFileSync(stubPath, "utf-8");
    expect(content).toContain("export async function processPayment");
  });

  it("step 8: add unit — buffer", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, ["unit", "payments", "buffer", "validatePayment", "--export"]);

    expect(result.exitCode).toBeUndefined();

    const stubPath = path.join(tmpDir, "src/compounds/payments/buffers/validatePayment.ts");
    expect(fs.existsSync(stubPath)).toBe(true);
    const content = fs.readFileSync(stubPath, "utf-8");
    expect(content).toContain("export function validatePayment");
  });

  it("step 9: manifest has all 6 units", () => {
    const manifestPath = path.join(tmpDir, "src/compounds/payments/compound.yaml");
    const manifest = parseYaml(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.units).toHaveLength(6);

    const roles = manifest.units.map((u: any) => u.role).sort();
    expect(roles).toEqual(["adapter", "buffer", "element", "interface", "molecule", "reaction"]);
  });

  it("step 10: scaffold (re-run is a no-op for existing files)", async () => {
    const { cmdScaffold } = await import("../../src/commands/scaffold.js");
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const result = runCmd(cmdScaffold, [wsPath]);

    // Should not fail
    expect(result.exitCode).toBeUndefined();

    // Output mentions skipped files (since stubs already exist)
    const output = result.stdout.join("\n");
    expect(output).toContain("skipped");
  });

  it("step 11: check passes with no errors", async () => {
    // Create public.ts for the compound to satisfy the check
    const publicPath = path.join(tmpDir, "src/compounds/payments/public.ts");
    if (!fs.existsSync(publicPath)) {
      // Generate via scaffold or write manually
      const { loadWorkspace, discoverCompounds } = await import("@chemag/core/loader");
      const { loadPlugin } = await import("../../src/plugin-loader.js");
      const ws = loadWorkspace(path.join(tmpDir, "workspace.yaml"));
      const compounds = discoverCompounds(ws, tmpDir);
      const plugin = loadPlugin({ language: "typescript" });
      const paymentCompound = compounds.find((c) => c.manifest.compound === "payments")!;
      const content = plugin.generatePublicSurface(paymentCompound, ws);
      fs.writeFileSync(publicPath, content, "utf-8");
    }

    const { cmdCheck } = await import("../../src/commands/check.js");
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const result = runCmd(cmdCheck, [wsPath]);

    // exit code 0 = no errors
    expect(result.exitCode).toBe(0);
    const output = result.stdout.join("\n");
    expect(output).toContain("passed");
  });

  it("step 12: analyze passes (stubs have no imports to violate)", async () => {
    const { cmdAnalyze } = await import("../../src/commands/analyze.js");
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const result = runCmd(cmdAnalyze, [wsPath]);

    // exit code 0 = no violations
    expect(result.exitCode).toBe(0);
    const output = result.stdout.join("\n");
    expect(output).toContain("All imports valid");
  });

  it("step 13: graph produces Mermaid output", async () => {
    const { cmdGraph } = await import("../../src/commands/graph.js");
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const result = runCmd(cmdGraph, [wsPath]);

    expect(result.exitCode).toBeUndefined();
    const output = result.stdout.join("\n");
    expect(output).toContain("graph LR");
    expect(output).toContain("payments");
  });

  it("step 14: CLI help text reflects language-agnostic nature", async () => {
    // Read the cli.ts source to verify help text
    const cliPath = path.join(path.dirname(new URL(import.meta.url).pathname), "../../src/cli.ts");
    const cliContent = fs.readFileSync(cliPath, "utf-8");
    expect(cliContent).toContain("chem-ag");
    expect(cliContent).toContain("language-agnostic");
    expect(cliContent).toContain("init");
    expect(cliContent).toContain("add");
    expect(cliContent).toContain("check");
    expect(cliContent).toContain("analyze");
    expect(cliContent).toContain("scaffold");
    expect(cliContent).toContain("graph");
    expect(cliContent).toContain("sync");
  });

  it("step 15: exit codes are correct for errors", async () => {
    const { cmdCheck } = await import("../../src/commands/check.js");

    // Missing workspace file
    const result = runCmd(cmdCheck, []);
    expect(result.exitCode).toBe(2);

    // Non-existent workspace
    const result2 = runCmd(cmdCheck, ["/nonexistent/workspace.yaml"]);
    expect(result2.exitCode).toBe(2);
  });
});
