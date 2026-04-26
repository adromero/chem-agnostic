// ---------------------------------------------------------------------------
// CLI tests for `chemag check-edit --format sarif|junit`. The wp-004 JSON
// shape is preserved verbatim under --format json (covered in
// check-edit.test.ts); this file only covers the new sarif/junit paths.
// ---------------------------------------------------------------------------
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify as yamlStringify } from "yaml";
import { runCli } from "../../src/cli.js";
import { __resetForTesting } from "@chemag/core/vocabulary";

let tmpDir: string;
let stdout: string[];
let stderr: string[];
let exitCode: number | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-checkedit-fmt-"));
  __resetForTesting();
  stdout = [];
  stderr = [];
  exitCode = undefined;

  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode = code;
    throw new Error("__cli_exit__");
  }) as never);
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(argv: string[]): void {
  try {
    runCli(argv);
  } catch (e: unknown) {
    if ((e as Error).message !== "__cli_exit__") throw e;
  }
}

function setup(): string {
  const ws = {
    workspace: "edit-app",
    language: "typescript",
    roles: {
      element: { description: "Value", folder: "elements" },
      reaction: { description: "Workflow", folder: "reactions" },
    },
    bonds: { element: ["element"], reaction: ["element"] },
    compound_types: { compound: { description: "Standard" } },
    paths: { compounds: "src/compounds" },
    rules: { cross_compound_imports: "public_only", role_from_path: true },
  };
  fs.writeFileSync(path.join(tmpDir, "workspace.yaml"), yamlStringify(ws), "utf-8");

  const orders = path.join(tmpDir, "src/compounds/orders");
  fs.mkdirSync(path.join(orders, "reactions"), { recursive: true });
  fs.writeFileSync(
    path.join(orders, "compound.yaml"),
    yamlStringify({
      compound: "orders",
      units: [{ role: "reaction", name: "createOrder", file: "./reactions/createOrder.ts" }],
    }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(orders, "reactions/createOrder.ts"),
    "export async function createOrder() {}\n",
    "utf-8",
  );
  return path.join(orders, "reactions/createOrder.ts");
}

describe("chemag check-edit --format", () => {
  it("--format sarif emits a single-result SARIF document for a clean file (zero results)", () => {
    const target = setup();
    run(["check-edit", target, "--format", "sarif"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.runs[0].results).toEqual([]);
  });

  it("--format junit emits XML with one testcase named after the file", () => {
    const target = setup();
    run(["check-edit", target, "--format", "junit"]);
    expect(exitCode).toBe(0);
    const out = stdout.join("\n");
    expect(out.startsWith("<?xml")).toBe(true);
    expect(out).toContain("createOrder.ts");
    expect(out).toContain("<testcase");
  });

  it("--format json continues to emit the wp-004 single-file shape", () => {
    const target = setup();
    run(["check-edit", target, "--format", "json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.join("\n"));
    // wp-004 shape: { file, compound, role, diagnostics } — no schemaVersion.
    expect(parsed.file).toBe(target);
    expect(parsed.compound).toBe("orders");
    expect(parsed.role).toBe("reaction");
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
    expect(parsed.schemaVersion).toBeUndefined();
  });

  it("rejects an invalid --format value with exit 2", () => {
    const target = setup();
    run(["check-edit", target, "--format", "xml"]);
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toMatch(/Invalid --format/);
  });
});
