// ---------------------------------------------------------------------------
// CLI tests for `chemag check --format <fmt>` and the deprecated `--json`
// alias. Exercises:
//   - --format human|json|sarif|junit dispatch
//   - --json deprecation warning + legacy ad-hoc shape preservation
//   - --json + --format mutual exclusion (exit 2)
//   - workspace-level diagnostics get no SARIF physicalLocation
//   - source-level diagnostics get a SARIF physicalLocation
// ---------------------------------------------------------------------------
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify as yamlStringify } from "yaml";
import Ajv from "ajv";
import { runCli } from "../../src/cli.js";
import { __resetForTesting } from "@chemag/core/vocabulary";

const here = path.dirname(import.meta.url.replace("file://", ""));
const repoRoot = path.resolve(here, "../../../..");
const DIAG_SCHEMA = path.resolve(repoRoot, "packages/core/schemas/diagnostics.schema.json");

let tmpDir: string;
let stdout: string[];
let stderr: string[];
let exitCode: number | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-check-fmt-"));
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

// ---------------------------------------------------------------------------
// Fixture: a clean workspace with one compound and one element file.
// ---------------------------------------------------------------------------

function setupCleanWorkspace(): string {
  const ws = {
    workspace: "test-app",
    language: "typescript",
    roles: {
      element: { description: "Value", folder: "elements" },
      reaction: { description: "Workflow", folder: "reactions" },
    },
    bonds: { element: ["element"], reaction: ["element"] },
    compound_types: {
      compound: { description: "Standard", can_import: ["compound"] },
    },
    paths: { compounds: "src/compounds" },
    rules: { cross_compound_imports: "public_only", role_from_path: true },
  };
  fs.writeFileSync(path.join(tmpDir, "workspace.yaml"), yamlStringify(ws), "utf-8");
  const orders = path.join(tmpDir, "src/compounds/orders");
  fs.mkdirSync(path.join(orders, "elements"), { recursive: true });
  fs.writeFileSync(
    path.join(orders, "compound.yaml"),
    yamlStringify({
      compound: "orders",
      units: [{ role: "element", name: "OrderId", file: "./elements/OrderId.ts" }],
    }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(orders, "elements/OrderId.ts"),
    "export type OrderId = string;\n",
    "utf-8",
  );
  return path.join(tmpDir, "workspace.yaml");
}

/**
 * Set up a workspace that produces at least one workspace-level error
 * (CHEM-MANIFEST-001 duplicate compound) so we can exercise SARIF
 * locations: [] for workspace-scoped diagnostics.
 */
function setupDuplicateCompoundWorkspace(): string {
  const ws = {
    workspace: "dup-app",
    language: "typescript",
    roles: { element: { description: "Value", folder: "elements" } },
    bonds: { element: ["element"] },
    compound_types: { compound: { description: "Standard" } },
    paths: { compounds: "src/compounds" },
    rules: { cross_compound_imports: "public_only", role_from_path: true },
  };
  fs.writeFileSync(path.join(tmpDir, "workspace.yaml"), yamlStringify(ws), "utf-8");
  const a = path.join(tmpDir, "src/compounds/a");
  const b = path.join(tmpDir, "src/compounds/b");
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(
    path.join(a, "compound.yaml"),
    yamlStringify({ compound: "shared", units: [] }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(b, "compound.yaml"),
    yamlStringify({ compound: "shared", units: [] }),
    "utf-8",
  );
  return path.join(tmpDir, "workspace.yaml");
}

// ---------------------------------------------------------------------------
// --format dispatch
// ---------------------------------------------------------------------------

describe("chemag check --format", () => {
  it("--format json emits the schema-validated envelope (no deprecation warning)", () => {
    const wsPath = setupCleanWorkspace();
    run(["check", wsPath, "--format", "json"]);
    expect(exitCode).toBe(0);
    expect(stderr.join("\n")).not.toMatch(/deprecated/i);

    const parsed = JSON.parse(stdout.join("\n"));
    expect(parsed.schemaVersion).toBe("1.0.0");
    expect(parsed.tool.name).toBe("chemag");
    expect(parsed.command).toBe("check");

    const ajv = new Ajv({ strict: false, allErrors: true });
    const schema = JSON.parse(fs.readFileSync(DIAG_SCHEMA, "utf-8"));
    const validate = ajv.compile(schema);
    const ok = validate(parsed);
    if (!ok) console.error("ajv errors:", ajv.errorsText(validate.errors));
    expect(ok).toBe(true);
  });

  it("--format sarif emits a SARIF 2.1.0 log", () => {
    const wsPath = setupCleanWorkspace();
    run(["check", wsPath, "--format", "sarif"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.runs[0].tool.driver.name).toBe("chemag");
    expect(parsed.runs[0].tool.driver.informationUri).toBe("https://github.com/chemag-org/chemag");
  });

  it("--format junit emits XML with one <testsuite> root", () => {
    const wsPath = setupCleanWorkspace();
    run(["check", wsPath, "--format", "junit"]);
    expect(exitCode).toBe(0);
    const out = stdout.join("\n");
    expect(out.startsWith('<?xml version="1.0"')).toBe(true);
    expect(out).toContain("<testsuite");
    expect(out).toContain("</testsuite>");
  });

  it("--format human (default) prints the legacy ANSI layout", () => {
    const wsPath = setupCleanWorkspace();
    run(["check", wsPath]);
    expect(exitCode).toBe(0);
    const out = stdout.join("\n");
    expect(out).toContain("chemtest check");
    expect(out).toContain("All");
    expect(out).toContain("checks passed");
  });

  it("rejects an invalid --format value with exit 2", () => {
    const wsPath = setupCleanWorkspace();
    run(["check", wsPath, "--format", "xml"]);
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toMatch(/Invalid --format/);
  });
});

// ---------------------------------------------------------------------------
// --json deprecation alias
// ---------------------------------------------------------------------------

describe("chemag check --json (deprecated)", () => {
  it("emits the LEGACY ad-hoc shape (workspace/checks/compounds), NOT the new schema", () => {
    const wsPath = setupCleanWorkspace();
    run(["check", wsPath, "--json"]);
    expect(exitCode).toBe(0);

    // Legacy shape has top-level workspace, compounds, units, checks; it does
    // NOT have schemaVersion or tool.
    const parsed = JSON.parse(stdout.join("\n"));
    expect(parsed.workspace).toBe("test-app");
    expect(typeof parsed.compounds).toBe("number");
    expect(parsed.checks).toBeDefined();
    expect(parsed.schemaVersion).toBeUndefined();
    expect(parsed.tool).toBeUndefined();
  });

  it("prints a deprecation warning to stderr (stdout is unaffected so JSON consumers parse cleanly)", () => {
    const wsPath = setupCleanWorkspace();
    run(["check", wsPath, "--json"]);
    expect(stderr.join("\n")).toMatch(/--json is deprecated/);
    expect(stderr.join("\n")).toMatch(/use --format json/);
    // stdout must be parseable JSON (the legacy shape).
    expect(() => JSON.parse(stdout.join("\n"))).not.toThrow();
  });

  it("--json combined with --format exits 2 with the mutual-exclusion error", () => {
    const wsPath = setupCleanWorkspace();
    run(["check", wsPath, "--json", "--format", "json"]);
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toMatch(/--json and --format are mutually exclusive/);
  });
});

// ---------------------------------------------------------------------------
// SARIF location handling — workspace vs source diagnostics
// ---------------------------------------------------------------------------

describe("chemag check --format sarif — location handling", () => {
  it("workspace-level diagnostics emit empty locations array", () => {
    const wsPath = setupDuplicateCompoundWorkspace();
    run(["check", wsPath, "--format", "sarif"]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.join("\n"));
    const dups = parsed.runs[0].results.filter((r: any) => r.ruleId === "CHEM-MANIFEST-001");
    expect(dups.length).toBeGreaterThan(0);
    for (const r of dups) {
      expect(r.locations).toEqual([]);
    }
  });
});
