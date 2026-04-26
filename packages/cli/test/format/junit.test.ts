// ---------------------------------------------------------------------------
// Tests for the JUnit XML emitter. Per the wp-005 spec we replace strict XSD
// validation with structural assertions via fast-xml-parser.
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { formatJunit } from "../../src/format/junit.js";
import {
  diagWithRemediation,
  makeAnalyzeContext,
  makeCheckContext,
  makeCheckEditContext,
  oneOfEachDiagnostic,
  sourceLevelDiag,
  warningDiag,
  workspaceLevelDiag,
} from "./fixtures.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: false,
  parseAttributeValue: false,
  trimValues: false,
  // ensure repeated children come back as arrays for predictable shape
  isArray: (name) => name === "testcase" || name === "failure" || name === "system-out",
});

function parse(xml: string): any {
  return parser.parse(xml);
}

// ---------------------------------------------------------------------------
// Smoke / structural invariants
// ---------------------------------------------------------------------------

describe("format/junit — structural invariants", () => {
  it("starts with the XML prolog and contains exactly one <testsuite>", () => {
    const xml = formatJunit([sourceLevelDiag()], makeCheckContext());
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const matches = xml.match(/<testsuite[\s>]/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("each <testcase> has classname and name attributes", () => {
    const xml = formatJunit([sourceLevelDiag(), warningDiag()], makeCheckContext());
    const doc = parse(xml);
    const cases = doc.testsuite.testcase as any[];
    expect(Array.isArray(cases)).toBe(true);
    for (const c of cases) {
      expect(c["@_classname"]).toBeDefined();
      expect(c["@_name"]).toBeDefined();
    }
  });

  it('failing testcase carries <failure type="<code>" message="<short>"> with text body', () => {
    const xml = formatJunit([sourceLevelDiag()], makeCheckContext());
    const doc = parse(xml);
    const cases = doc.testsuite.testcase as any[];
    const orders = cases.find((c) => c["@_name"] === "orders");
    expect(orders).toBeDefined();
    const failures = orders.failure;
    expect(Array.isArray(failures)).toBe(true);
    expect(failures[0]["@_type"]).toBe("CHEM-BOND-003");
    expect(typeof failures[0]["@_message"]).toBe("string");
    expect(failures[0]["@_message"].length).toBeGreaterThan(0);
    // Body should contain the rendered hint and file path.
    const body = String(failures[0]["#text"] ?? "");
    expect(body).toContain("dependency rule violation");
    expect(body).toContain("file:");
  });

  it("warnings render as <system-out>, not <failure> (CI gate stays green for warnings)", () => {
    const xml = formatJunit([warningDiag()], makeCheckContext());
    const doc = parse(xml);
    const cases = doc.testsuite.testcase as any[];
    const orders = cases.find((c) => c["@_name"] === "orders");
    expect(orders.failure).toBeUndefined();
    expect(orders["system-out"]).toBeDefined();
  });

  it("testsuite tests/failures/errors counts match the actual children", () => {
    const xml = formatJunit(
      [sourceLevelDiag(), diagWithRemediation(), warningDiag()],
      makeCheckContext(),
    );
    const doc = parse(xml);
    const suite = doc.testsuite;
    const cases = suite.testcase as any[];
    const failures = cases.flatMap((c) => (c.failure ?? []) as any[]);
    expect(Number(suite["@_tests"])).toBe(cases.length);
    expect(Number(suite["@_failures"])).toBe(failures.length);
    expect(Number(suite["@_errors"])).toBe(0);
  });

  it("output ends with a single trailing newline", () => {
    const xml = formatJunit([], makeCheckContext());
    expect(xml.endsWith("\n")).toBe(true);
    expect(xml.endsWith("\n\n")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Compound bucketing
// ---------------------------------------------------------------------------

describe("format/junit — compound bucketing for check/analyze", () => {
  it("workspace-level diagnostic buckets into the synthetic 'workspace' testcase", () => {
    const xml = formatJunit([workspaceLevelDiag()], makeCheckContext());
    const doc = parse(xml);
    const cases = doc.testsuite.testcase as any[];
    const ws = cases.find((c) => c["@_name"] === "workspace");
    expect(ws).toBeDefined();
    expect(ws.failure).toBeDefined();
    expect(Array.isArray(ws.failure) ? ws.failure[0] : ws.failure).toMatchObject({
      "@_type": "CHEM-MANIFEST-001",
    });
  });

  it("check command emits the synthetic workspace testcase even when empty", () => {
    const xml = formatJunit([sourceLevelDiag()], makeCheckContext());
    const doc = parse(xml);
    const cases = doc.testsuite.testcase as any[];
    const ws = cases.find((c) => c["@_name"] === "workspace");
    // For check, we always include the workspace bucket so dashboards see it.
    expect(ws).toBeDefined();
  });

  it("analyze does NOT inject an empty workspace testcase when there are no workspace-level diagnostics", () => {
    const xml = formatJunit([sourceLevelDiag()], makeAnalyzeContext());
    const doc = parse(xml);
    const cases = doc.testsuite.testcase as any[];
    const ws = cases.find((c) => c["@_name"] === "workspace");
    expect(ws).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// check-edit per-file testcase
// ---------------------------------------------------------------------------

describe("format/junit — check-edit per-file testcase", () => {
  it("uses the file path as the testcase name", () => {
    const xml = formatJunit([sourceLevelDiag()], makeCheckEditContext());
    const doc = parse(xml);
    const cases = doc.testsuite.testcase as any[];
    expect(cases.length).toBe(1);
    expect(cases[0]["@_name"]).toContain("createOrder.ts");
  });
});

// ---------------------------------------------------------------------------
// Registry coverage — every code can be expressed in JUnit
// ---------------------------------------------------------------------------

describe("format/junit — registry coverage", () => {
  it("can emit one testcase set covering every registered code without throwing", () => {
    const xml = formatJunit(oneOfEachDiagnostic(), makeCheckContext());
    expect(() => parse(xml)).not.toThrow();
    const doc = parse(xml);
    expect(doc.testsuite).toBeDefined();
  });
});
