// ---------------------------------------------------------------------------
// CLI tests for `chemag analyze --format <fmt>` and the deprecated `--json`
// alias. Mirrors check-formats.test.ts. Uses a real bond-violation fixture to
// exercise SARIF physicalLocation population (Diagnostic.file is set by
// import-check.ts as of wp-005).
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-analyze-fmt-"));
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

/**
 * A workspace where `orders/reactions/createOrder.ts` imports an internal
 * file from `billing` — triggers CHEM-IMPORT-004 (import-bypass) AND
 * CHEM-IMPORT-003 (import-undeclared). Both diagnostics carry `file` (set
 * by import-check.ts).
 */
function setupBypassWorkspace(): string {
  const ws = {
    workspace: "fmt-app",
    language: "typescript",
    roles: {
      element: { description: "Value", folder: "elements" },
      interface: { description: "Port", folder: "interfaces" },
      adapter: { description: "Adapter", folder: "adapters" },
      reaction: { description: "Workflow", folder: "reactions" },
    },
    bonds: {
      element: ["element"],
      interface: ["element"],
      adapter: ["element", "interface", "adapter"],
      reaction: ["element", "interface"],
    },
    compound_types: { compound: { description: "Standard", can_import: ["compound"] } },
    paths: { compounds: "src/compounds" },
    rules: {
      cross_compound_imports: "public_only",
      role_from_path: true,
      public_surface: "public.ts",
    },
  };
  fs.writeFileSync(path.join(tmpDir, "workspace.yaml"), yamlStringify(ws), "utf-8");

  // billing — interface only (so a reaction can import an interface, no bond
  // violation; import-bypass + import-undeclared are the targets).
  const billing = path.join(tmpDir, "src/compounds/billing");
  fs.mkdirSync(path.join(billing, "interfaces"), { recursive: true });
  fs.writeFileSync(
    path.join(billing, "compound.yaml"),
    yamlStringify({
      compound: "billing",
      exports: { interfaces: ["BillingRepo"] },
      units: [{ role: "interface", name: "BillingRepo", file: "./interfaces/BillingRepo.ts" }],
    }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(billing, "interfaces/BillingRepo.ts"),
    "export interface BillingRepo {}\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(billing, "public.ts"),
    'export type { BillingRepo } from "./interfaces/BillingRepo";\n',
    "utf-8",
  );

  // orders — imports billing's INTERNAL file directly and doesn't list it.
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
    'import type { BillingRepo } from "../../billing/interfaces/BillingRepo";\nexport async function createOrder(_b: BillingRepo) {}\n',
    "utf-8",
  );

  return path.join(tmpDir, "workspace.yaml");
}

// ---------------------------------------------------------------------------
// Format dispatch
// ---------------------------------------------------------------------------

describe("chemag analyze --format", () => {
  it("--format json emits the schema-validated envelope", () => {
    const wsPath = setupBypassWorkspace();
    run(["analyze", wsPath, "--format", "json"]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(parsed.schemaVersion).toBe("1.0.0");
    expect(parsed.command).toBe("analyze");
    expect(parsed.diagnostics.length).toBeGreaterThan(0);

    const ajv = new Ajv({ strict: false, allErrors: true });
    const schema = JSON.parse(fs.readFileSync(DIAG_SCHEMA, "utf-8"));
    const validate = ajv.compile(schema);
    expect(validate(parsed)).toBe(true);
  });

  it("--format sarif populates physicalLocation for source-level diagnostics", () => {
    const wsPath = setupBypassWorkspace();
    run(["analyze", wsPath, "--format", "sarif"]);
    expect(exitCode).toBe(1);
    const sarif = JSON.parse(stdout.join("\n"));
    const results = sarif.runs[0].results;
    expect(results.length).toBeGreaterThan(0);
    // Every result should have a non-empty locations array (import-check
    // diagnostics all carry `file`).
    for (const r of results) {
      expect(Array.isArray(r.locations)).toBe(true);
      expect(r.locations.length).toBeGreaterThanOrEqual(1);
      const uri = r.locations[0].physicalLocation.artifactLocation.uri;
      expect(typeof uri).toBe("string");
      expect(uri).toContain("createOrder.ts");
    }
  });

  it("--format junit produces parseable XML with at least one <failure>", () => {
    const wsPath = setupBypassWorkspace();
    run(["analyze", wsPath, "--format", "junit"]);
    expect(exitCode).toBe(1);
    const out = stdout.join("\n");
    expect(out.startsWith("<?xml")).toBe(true);
    expect(out).toContain("<failure");
  });
});

// ---------------------------------------------------------------------------
// --json deprecation alias
// ---------------------------------------------------------------------------

describe("chemag analyze --json (deprecated)", () => {
  it("emits the LEGACY ad-hoc shape (errors/warnings/diagnostics top-level)", () => {
    const wsPath = setupBypassWorkspace();
    run(["analyze", wsPath, "--json"]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(typeof parsed.errors).toBe("number");
    expect(typeof parsed.warnings).toBe("number");
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
    // No new schema fields.
    expect(parsed.schemaVersion).toBeUndefined();
    expect(parsed.tool).toBeUndefined();
  });

  it("prints a deprecation warning to stderr", () => {
    const wsPath = setupBypassWorkspace();
    run(["analyze", wsPath, "--json"]);
    expect(stderr.join("\n")).toMatch(/--json is deprecated/);
  });

  it("--json combined with --format exits 2 with the mutual-exclusion error", () => {
    const wsPath = setupBypassWorkspace();
    run(["analyze", wsPath, "--json", "--format", "sarif"]);
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toMatch(/--json and --format are mutually exclusive/);
  });
});
