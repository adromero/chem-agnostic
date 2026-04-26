// ---------------------------------------------------------------------------
// CLI tests for `chemag check-edit`. Exercises the full command including:
//   - workspace auto-discovery (upward walk from the file)
//   - --content / stdin path
//   - --proposed-role / --proposed-compound proposal path
//   - JSON schema validation against schemas/check-edit-result.schema.json
//   - help text snapshot
//   - cache parity (warm hit identical to cold run)
//   - exit code conventions
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as yamlStringify } from "yaml";
import { runCli } from "../../src/cli.js";
import { __resetCacheStateForTesting, setCacheEnabled } from "../../src/cache/cache-state.js";
import {
  __resetStdinReaderForTesting,
  __setStdinReaderForTesting,
} from "../../src/commands/check-edit.js";
import { __resetForTesting } from "@chemag/core/vocabulary";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const SCHEMA_PATH = path.resolve(repoRoot, "packages/core/schemas/check-edit-result.schema.json");

let tmpDir: string;
let stdout: string[];
let stderr: string[];
let exitCode: number | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-check-edit-cli-"));
  __resetForTesting();
  __resetCacheStateForTesting();
  setCacheEnabled(false); // default: tests opt-in to cache
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
  __resetStdinReaderForTesting();
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function run(argv: string[]): void {
  try {
    runCli(argv);
  } catch (e: unknown) {
    if ((e as Error).message !== "__cli_exit__") throw e;
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const STD_WS = {
  workspace: "test-app",
  language: "typescript",
  roles: {
    element: { description: "value object", folder: "elements" },
    molecule: { description: "entity", folder: "molecules" },
    reaction: { description: "use case", folder: "reactions" },
    interface: { description: "port", folder: "interfaces" },
    adapter: { description: "adapter", folder: "adapters" },
    buffer: { description: "buffer", folder: "buffers" },
  },
  bonds: {
    element: ["element"],
    molecule: ["element", "molecule"],
    reaction: ["element", "molecule", "interface"],
    interface: ["element", "molecule"],
    adapter: ["element", "molecule", "interface", "adapter"],
    buffer: ["element", "molecule", "interface"],
  },
  compound_types: {
    compound: { description: "feature", can_import: ["compound", "reagent"] },
    reagent: { description: "shared", can_import: ["reagent"] },
    solvent: { description: "infra", can_import: ["reagent"], implicit: true },
    catalyst: { description: "wiring", singleton: true },
  },
  paths: {
    compounds: "src/compounds",
    reagents: "src/reagents",
    solvents: "src/solvents",
    catalyst: "src/catalyst",
  },
  rules: {
    cross_compound_imports: "public_only",
    role_from_path: true,
    public_surface: "public.ts",
    manifest_filename: "compound.yaml",
  },
};

function setupBaseWorkspace(): void {
  fs.writeFileSync(path.join(tmpDir, "workspace.yaml"), yamlStringify(STD_WS), "utf-8");

  // orders compound: imports billing, has reaction createOrder
  const ordersDir = path.join(tmpDir, "src/compounds/orders");
  fs.mkdirSync(path.join(ordersDir, "reactions"), { recursive: true });
  fs.writeFileSync(
    path.join(ordersDir, "compound.yaml"),
    yamlStringify({
      compound: "orders",
      imports: [{ compound: "billing" }],
      units: [{ role: "reaction", name: "createOrder", file: "./reactions/createOrder.ts" }],
    }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(ordersDir, "reactions/createOrder.ts"),
    "// clean — no imports\nexport async function createOrder() {}\n",
    "utf-8",
  );

  // billing compound: exposes BillingRepo (interface) and PgBilling (adapter)
  const billingDir = path.join(tmpDir, "src/compounds/billing");
  fs.mkdirSync(path.join(billingDir, "interfaces"), { recursive: true });
  fs.mkdirSync(path.join(billingDir, "adapters"), { recursive: true });
  fs.writeFileSync(
    path.join(billingDir, "compound.yaml"),
    yamlStringify({
      compound: "billing",
      exports: { interfaces: ["BillingRepo"] },
      units: [
        { role: "interface", name: "BillingRepo", file: "./interfaces/BillingRepo.ts" },
        {
          role: "adapter",
          name: "PgBilling",
          file: "./adapters/PgBilling.ts",
          implements: ["BillingRepo"],
        },
      ],
    }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(billingDir, "interfaces/BillingRepo.ts"),
    "export interface BillingRepo {}\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(billingDir, "adapters/PgBilling.ts"),
    "export class PgBilling {}\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(billingDir, "public.ts"),
    'export type { BillingRepo } from "./interfaces/BillingRepo";\n',
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

describe("chemag check-edit --help", () => {
  it("prints help and exits 0 without resolving a workspace", () => {
    run(["check-edit", "--help"]);
    expect(exitCode).toBe(0);
    const out = stdout.join("\n");
    expect(out).toContain("check-edit");
    expect(out).toContain("--content");
    expect(out).toContain("--proposed-role");
    expect(out).toContain("--proposed-compound");
    expect(out).toContain("--workspace");
    expect(out).toContain("--format");
  });
});

// ---------------------------------------------------------------------------
// Workspace auto-discovery
// ---------------------------------------------------------------------------

describe("chemag check-edit — workspace auto-discovery", () => {
  it("walks upward from the file path to find workspace.yaml", () => {
    setupBaseWorkspace();
    const target = path.join(tmpDir, "src/compounds/orders/reactions/createOrder.ts");

    run(["check-edit", target, "--format", "json"]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout.join("\n"));
    expect(result.compound).toBe("orders");
    expect(result.role).toBe("reaction");
  });

  it("exits 2 when no workspace.yaml can be found", () => {
    // Different temp dir — no workspace anywhere.
    const stray = fs.mkdtempSync(path.join(os.tmpdir(), "chem-stray-"));
    try {
      run(["check-edit", path.join(stray, "foo.ts")]);
      expect(exitCode).toBe(2);
      expect(stderr.join("\n")).toMatch(/workspace/i);
    } finally {
      fs.rmSync(stray, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// --content / stdin path
// ---------------------------------------------------------------------------

describe("chemag check-edit — --content path", () => {
  it("accepts --content - and reads from stdin", () => {
    setupBaseWorkspace();
    const target = path.join(tmpDir, "src/compounds/orders/reactions/createOrder.ts");

    const dirty =
      'import { PgBilling } from "../../billing/adapters/PgBilling";\nexport async function createOrder() { new PgBilling(); }\n';
    __setStdinReaderForTesting(() => dirty);

    run(["check-edit", target, "--content", "-", "--format", "json"]);
    expect(exitCode).toBe(1); // bond violation -> exit 1

    const result = JSON.parse(stdout.join("\n"));
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.some((d: { code: string }) => d.code === "CHEM-BOND-003")).toBe(true);
  });

  it("accepts inline --content <string> for files that don't exist on disk yet", () => {
    setupBaseWorkspace();
    // File doesn't exist; use proposed flags.
    const target = path.join(tmpDir, "src/compounds/orders/elements/NewThing.ts");

    run([
      "check-edit",
      target,
      "--content",
      "export class NewThing {}\n",
      "--proposed-role",
      "element",
      "--proposed-compound",
      "orders",
      "--format",
      "json",
    ]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout.join("\n"));
    expect(result.compound).toBe("orders");
    expect(result.role).toBe("element");
  });
});

// ---------------------------------------------------------------------------
// CHEM-PLACEMENT-004
// ---------------------------------------------------------------------------

describe("chemag check-edit — unresolvable placement", () => {
  it("emits CHEM-PLACEMENT-004 and exits 1 for files outside any compound root", () => {
    setupBaseWorkspace();
    fs.mkdirSync(path.join(tmpDir, "src/random"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/random/floating.ts"), "export const x = 1;\n", "utf-8");

    run([
      "check-edit",
      path.join(tmpDir, "src/random/floating.ts"),
      "--workspace",
      path.join(tmpDir, "workspace.yaml"),
      "--format",
      "json",
    ]);
    expect(exitCode).toBe(1);

    const result = JSON.parse(stdout.join("\n"));
    expect(result.compound).toBeNull();
    expect(result.role).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("CHEM-PLACEMENT-004");
  });
});

// ---------------------------------------------------------------------------
// Argument validation (proposed-* flags)
// ---------------------------------------------------------------------------

describe("chemag check-edit — proposal validation", () => {
  it("exits 2 when --proposed-role is unknown", () => {
    setupBaseWorkspace();
    run([
      "check-edit",
      path.join(tmpDir, "src/compounds/orders/elements/X.ts"),
      "--content",
      "export class X {}",
      "--proposed-role",
      "not-a-role",
      "--proposed-compound",
      "orders",
    ]);
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toMatch(/unknown role/i);
  });

  it("exits 2 when --proposed-compound is unknown", () => {
    setupBaseWorkspace();
    run([
      "check-edit",
      path.join(tmpDir, "src/compounds/orders/elements/X.ts"),
      "--content",
      "export class X {}",
      "--proposed-role",
      "element",
      "--proposed-compound",
      "not-a-compound",
    ]);
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toMatch(/unknown compound/i);
  });

  it("exits 2 when only one of --proposed-* is supplied", () => {
    setupBaseWorkspace();
    run([
      "check-edit",
      path.join(tmpDir, "src/compounds/orders/elements/X.ts"),
      "--content",
      "export class X {}",
      "--proposed-role",
      "element",
      // no --proposed-compound
    ]);
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toMatch(/together|--proposed-compound/i);
  });
});

// ---------------------------------------------------------------------------
// JSON schema validation
// ---------------------------------------------------------------------------

describe("chemag check-edit — JSON schema validation", () => {
  it("the schema file ships with @chemag/core and parses as valid JSON", () => {
    expect(fs.existsSync(SCHEMA_PATH)).toBe(true);
    const raw = fs.readFileSync(SCHEMA_PATH, "utf-8");
    const schema = JSON.parse(raw);
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.title).toBe("CheckEditResult");
    expect(schema.required).toContain("file");
    expect(schema.required).toContain("diagnostics");
    expect(schema.definitions.diagnostic.properties.code.pattern).toBe("^CHEM-[A-Z]+-[0-9]{3}$");
    // Five remediation kinds.
    const kinds = schema.definitions.remediation.oneOf.map(
      (r: { properties: { kind: { const: string } } }) => r.properties.kind.const,
    );
    expect(kinds.sort()).toEqual([
      "add_compound_import",
      "import_via_public_surface",
      "move_to_compound",
      "move_to_role_folder",
      "use_interface",
    ]);
  });

  it("a real check-edit JSON output validates against the schema", () => {
    setupBaseWorkspace();
    const target = path.join(tmpDir, "src/compounds/orders/reactions/createOrder.ts");

    run(["check-edit", target, "--format", "json"]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout.join("\n"));
    // Mini structural validation against the published schema. We don't pull
    // ajv into devDeps for one test; instead, assert the load-bearing
    // invariants explicitly.
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8"));
    expect(typeof result.file).toBe("string");
    expect(Array.isArray(result.diagnostics)).toBe(true);

    const codePattern = new RegExp(schema.definitions.diagnostic.properties.code.pattern);
    for (const d of result.diagnostics) {
      expect(typeof d.level).toBe("string");
      expect(["error", "warning"]).toContain(d.level);
      expect(typeof d.code).toBe("string");
      expect(d.code).toMatch(codePattern);
      expect(typeof d.message).toBe("string");
      if (d.remediation) {
        expect(typeof d.remediation.kind).toBe("string");
        expect([
          "use_interface",
          "move_to_compound",
          "move_to_role_folder",
          "import_via_public_surface",
          "add_compound_import",
        ]).toContain(d.remediation.kind);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Cache parity
// ---------------------------------------------------------------------------

describe("chemag check-edit — cache parity", () => {
  it("warm cache run produces an identical result to a cold (no-cache) run", () => {
    setupBaseWorkspace();
    const target = path.join(tmpDir, "src/compounds/orders/reactions/createOrder.ts");

    // Cold run (cache disabled by default in our beforeEach).
    setCacheEnabled(false);
    run(["check-edit", target, "--format", "json"]);
    const cold = JSON.parse(stdout.join("\n"));

    stdout = [];
    stderr = [];
    exitCode = undefined;

    // Warm run — first call populates the cache, second hits it.
    setCacheEnabled(true);
    run(["check-edit", target, "--format", "json"]);
    const firstWarm = JSON.parse(stdout.join("\n"));

    stdout = [];
    stderr = [];
    exitCode = undefined;
    run(["check-edit", target, "--format", "json"]);
    const secondWarm = JSON.parse(stdout.join("\n"));

    expect(firstWarm).toEqual(cold);
    expect(secondWarm).toEqual(cold);
  });
});

// ---------------------------------------------------------------------------
// Exit codes / human format smoke
// ---------------------------------------------------------------------------

describe("chemag check-edit — exit code conventions", () => {
  it("returns 0 for a clean file (human format)", () => {
    setupBaseWorkspace();
    run(["check-edit", path.join(tmpDir, "src/compounds/orders/reactions/createOrder.ts")]);
    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toMatch(/no diagnostics/i);
  });

  it("returns 2 with no file argument", () => {
    setupBaseWorkspace();
    run(["check-edit"]);
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toMatch(/file argument/i);
  });
});
