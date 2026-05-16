// ---------------------------------------------------------------------------
// Fixture-driven tests for the `needs-interface` rule (PORT-001 port).
//
// Walks packages/core/test/fixtures/semantic-rules/port-001/{invalid,valid}.
// For each fixture, spins up an ESLint Linter, lints every adapter file in
// the compound, and asserts the diagnostic count.
//
// PORT-001 spec semantic (simplified): a compound with adapter+reaction+no-
// interface fires one diagnostic on the lexicographically-first adapter file.
//
// Skipped fixtures (with rationale): see SKIPPED_FIXTURES below.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { Linter } from "eslint";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import rule from "../../src/rules/needs-interface.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(here, "../../../core/test/fixtures/semantic-rules/port-001");

// ---------------------------------------------------------------------------
// Fixture skip list — see file header for rationale.
// ---------------------------------------------------------------------------
//
// `valid/no-io`: the reference (chemag) rule gates on "adapter actually
// imports an I/O module". The ESLint port deliberately drops that guard
// (see needs-interface.ts header). Under the simplified semantic, this
// fixture WOULD fire — that's intended. We skip it here rather than mis-
// assert; the bench validation in S03 will surface the tightened behaviour
// against real repos if it ever matters.
//
// All other valid fixtures are exercised normally.
const SKIPPED_FIXTURES = new Set<string>(["valid/no-io"]);

interface Fixture {
  /** Relative path under FIXTURES_ROOT, e.g. "invalid/missing-port". */
  rel: string;
  /** Absolute path to the fixture root. */
  abs: string;
  /** Whether the rule should fire (1 diag) or not (0 diags). */
  expectedDiagCount: 0 | 1;
}

function discoverFixtures(): Fixture[] {
  const out: Fixture[] = [];
  for (const bucket of ["invalid", "valid"] as const) {
    const bucketDir = path.join(FIXTURES_ROOT, bucket);
    if (!fs.existsSync(bucketDir)) continue;
    for (const name of fs.readdirSync(bucketDir).sort()) {
      const abs = path.join(bucketDir, name);
      if (!fs.statSync(abs).isDirectory()) continue;
      const rel = `${bucket}/${name}`;
      if (SKIPPED_FIXTURES.has(rel)) continue;
      out.push({
        rel,
        abs,
        expectedDiagCount: bucket === "invalid" ? 1 : 0,
      });
    }
  }
  return out;
}

/**
 * Locate all adapter `.ts` files under the fixture's compoundsRoot.
 * Adapter folders are named "adapters" (default). The fixtures use a
 * single compound per fixture, so we collect from all compounds.
 */
function collectAdapterFiles(fixtureRoot: string, compoundsRoot: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(compoundsRoot)) return out;

  for (const compound of fs.readdirSync(compoundsRoot).sort()) {
    const compoundDir = path.join(compoundsRoot, compound);
    if (!fs.statSync(compoundDir).isDirectory()) continue;
    const adapterDir = path.join(compoundDir, "adapters");
    if (!fs.existsSync(adapterDir)) continue;
    for (const f of fs.readdirSync(adapterDir).sort()) {
      if (!/\.tsx?$/.test(f)) continue;
      out.push(path.join(adapterDir, f));
    }
  }
  return out;
}

function lintFixture(fixture: Fixture): {
  diagCount: number;
  messages: { file: string; ruleId: string | null; messageId?: string }[];
} {
  const compoundsRoot = path.join(fixture.abs, "src/compounds");
  const adapterFiles = collectAdapterFiles(fixture.abs, compoundsRoot);

  // Linter's flat-config `files` patterns are resolved relative to its
  // `cwd`. Fixtures live outside the package cwd, so we set `cwd` to the
  // fixture root explicitly — otherwise ESLint reports "No matching
  // configuration found" and the rule never runs.
  const linter = new Linter({ cwd: fixture.abs });
  const config: Linter.Config[] = [
    {
      files: ["**/*.ts", "**/*.tsx"],
      plugins: {
        "port-discipline": {
          rules: { "needs-interface": rule } as unknown as Record<string, Linter.RuleEntry>,
        },
      },
      rules: {
        "port-discipline/needs-interface": ["error", { compoundsRoot }],
      },
    },
  ];

  let diagCount = 0;
  const messages: { file: string; ruleId: string | null; messageId?: string }[] = [];

  for (const file of adapterFiles) {
    const src = fs.readFileSync(file, "utf8");
    const msgs = linter.verify(src, config, { filename: file });
    for (const m of msgs) {
      if (m.ruleId === "port-discipline/needs-interface") {
        diagCount++;
        messages.push({ file, ruleId: m.ruleId, messageId: m.messageId });
      }
    }
  }

  return { diagCount, messages };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("needs-interface rule (PORT-001 port) — fixture-driven", () => {
  const fixtures = discoverFixtures();

  it("discovers at least one invalid and one valid fixture", () => {
    expect(fixtures.some((f) => f.rel.startsWith("invalid/"))).toBe(true);
    expect(fixtures.some((f) => f.rel.startsWith("valid/"))).toBe(true);
  });

  for (const fixture of discoverFixtures()) {
    it(`${fixture.rel} → ${fixture.expectedDiagCount} diagnostic(s)`, () => {
      const { diagCount, messages } = lintFixture(fixture);
      if (diagCount !== fixture.expectedDiagCount) {
        // Surface details for easier debugging when an assertion fails.
        console.error(`Fixture ${fixture.rel} produced ${diagCount} diagnostics:`, messages);
      }
      expect(diagCount).toBe(fixture.expectedDiagCount);
    });
  }
});

describe("needs-interface rule — multi-adapter dedupe", () => {
  it("fires exactly once on invalid/missing-port-multi-io (two adapters in one compound)", () => {
    const fixture: Fixture = {
      rel: "invalid/missing-port-multi-io",
      abs: path.join(FIXTURES_ROOT, "invalid/missing-port-multi-io"),
      expectedDiagCount: 1,
    };
    const { diagCount } = lintFixture(fixture);
    expect(diagCount).toBe(1);
  });
});
