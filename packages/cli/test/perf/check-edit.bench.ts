// ---------------------------------------------------------------------------
// Performance gates for `chemag check-edit`.
//
// wp-004 budgets:
//   - Warm path (cache populated):  < 100 ms — gated on TypeScript fixture.
//   - Cold path (no cache):         < 500 ms — gated on TypeScript fixture.
//
// Python's cold path includes a `python3` subprocess spawn whose duration is
// environment-dependent (WSL fs sync, interpreter cold-start, etc.); a
// separate informational smoke check runs without an `expect()` assertion on
// duration so it can never fail the build.
//
// We use a regular vitest `describe` with a duration assertion rather than
// the `bench` runner because we want a hard CI fail at threshold rather than
// a benchmark report — and we want to run inside the same vitest invocation
// as the rest of the suite.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { runCli } from "../../src/cli.js";
import { __resetCacheStateForTesting, setCacheEnabled } from "../../src/cache/cache-state.js";
import { __resetForTesting } from "@chemag/core/vocabulary";

const WARM_BUDGET_MS = 100;
const COLD_BUDGET_MS = 500;

let tmpDir: string;

beforeAll(() => {
  __resetForTesting();
  __resetCacheStateForTesting();

  // Build a small but realistic TypeScript fixture once.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-bench-"));
  buildTsFixture(tmpDir);
});

afterAll(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TypeScript fixture builder
// ---------------------------------------------------------------------------

function buildTsFixture(root: string): void {
  fs.writeFileSync(
    path.join(root, "workspace.yaml"),
    yamlStringify({
      workspace: "bench-app",
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
    }),
    "utf-8",
  );

  // orders compound — the file under test sits here.
  const ordersDir = path.join(root, "src/compounds/orders");
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
    'import type { BillingRepo } from "../../billing/public";\n' +
      "export async function createOrder(_repo: BillingRepo) {}\n",
    "utf-8",
  );

  // billing compound.
  const billingDir = path.join(root, "src/compounds/billing");
  fs.mkdirSync(path.join(billingDir, "interfaces"), { recursive: true });
  fs.writeFileSync(
    path.join(billingDir, "compound.yaml"),
    yamlStringify({
      compound: "billing",
      exports: { interfaces: ["BillingRepo"] },
      units: [{ role: "interface", name: "BillingRepo", file: "./interfaces/BillingRepo.ts" }],
    }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(billingDir, "interfaces/BillingRepo.ts"),
    "export interface BillingRepo {}\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(billingDir, "public.ts"),
    'export type { BillingRepo } from "./interfaces/BillingRepo";\n',
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Bench helpers
// ---------------------------------------------------------------------------

function silenceCli(): () => void {
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
    throw new Error("__cli_exit__");
  }) as never);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  return () => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  };
}

function runOnce(target: string): number {
  const restore = silenceCli();
  const start = performance.now();
  try {
    runCli(["check-edit", target, "--format", "json"]);
  } catch (e: unknown) {
    if ((e as Error).message !== "__cli_exit__") {
      restore();
      throw e;
    }
  }
  const elapsed = performance.now() - start;
  restore();
  return elapsed;
}

/**
 * Median of N runs — robust to a single noisy outlier on a busy CI host.
 */
function medianRun(target: string, n: number): number {
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    samples.push(runOnce(target));
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

// ---------------------------------------------------------------------------
// TypeScript fixture — gated assertions
// ---------------------------------------------------------------------------

describe("chemag check-edit perf — TypeScript fixture", () => {
  it("cold path (no cache) completes under 500 ms", () => {
    const target = path.join(tmpDir, "src/compounds/orders/reactions/createOrder.ts");
    setCacheEnabled(false);

    // Warm-up the TS plugin once so we don't measure ts-morph's cold-start.
    runOnce(target);
    const median = medianRun(target, 3);
    // eslint-disable-next-line no-console
    process.stderr.write(`[bench] check-edit cold-ts median=${median.toFixed(1)}ms\n`);
    expect(median).toBeLessThan(COLD_BUDGET_MS);
  });

  it("warm path (cache populated) completes under 100 ms", () => {
    const target = path.join(tmpDir, "src/compounds/orders/reactions/createOrder.ts");
    setCacheEnabled(true);

    // First run populates the cache.
    runOnce(target);
    const median = medianRun(target, 5);
    process.stderr.write(`[bench] check-edit warm-ts median=${median.toFixed(1)}ms\n`);
    expect(median).toBeLessThan(WARM_BUDGET_MS);
  });
});

// ---------------------------------------------------------------------------
// Python informational smoke — ungated. Reports a number to stderr but does
// NOT assert on duration: Python's cold path includes a python3 subprocess
// spawn whose timing is environment-dependent. wp-004 documents this as
// best-effort and explicitly out of scope for the perf gate.
// ---------------------------------------------------------------------------

describe("chemag check-edit perf — Python informational only", () => {
  it("reports a duration but does not assert on it", () => {
    // Build a tiny Python workspace inside tmpDir/python.
    const pyRoot = path.join(tmpDir, "python");
    fs.mkdirSync(pyRoot, { recursive: true });
    fs.writeFileSync(
      path.join(pyRoot, "workspace.yaml"),
      yamlStringify({
        workspace: "py-bench",
        language: "python",
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
        paths: { compounds: "src/compounds" },
        rules: { manifest_filename: "compound.yaml" },
      }),
      "utf-8",
    );
    const cdir = path.join(pyRoot, "src/compounds/orders");
    fs.mkdirSync(path.join(cdir, "reactions"), { recursive: true });
    fs.writeFileSync(
      path.join(cdir, "compound.yaml"),
      yamlStringify({
        compound: "orders",
        units: [{ role: "reaction", name: "create_order", file: "./reactions/create_order.py" }],
      }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(cdir, "reactions/create_order.py"),
      "def create_order():\n    pass\n",
      "utf-8",
    );

    const target = path.join(cdir, "reactions/create_order.py");
    setCacheEnabled(true);
    let elapsed = -1;
    try {
      runOnce(target); // populate cache
      elapsed = medianRun(target, 3);
      process.stderr.write(`[bench] check-edit warm-py median=${elapsed.toFixed(1)}ms\n`);
    } catch (e: unknown) {
      // python3 may not be available on every CI host. Treat as informational.
      process.stderr.write(
        `[bench] check-edit python smoke skipped: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
    // No assertion on `elapsed` — informational only.
    expect(true).toBe(true);
  });
});
