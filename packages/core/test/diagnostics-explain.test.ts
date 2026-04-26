// ---------------------------------------------------------------------------
// Tests for the explainCode formatter (`packages/core/src/diagnostics/explain.ts`).
// CLI-level wiring of `--explain` is exercised separately in
// `packages/cli/test/check-explain.test.ts`.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import {
  DOC_BASE_URL,
  docLinkFor,
  explainCode,
  formatExplainBlock,
  knownCode,
} from "../src/diagnostics/explain.js";
import { DIAGNOSTIC_CODES, type DiagnosticCode } from "../src/diagnostics/codes.js";

describe("explainCode", () => {
  it("returns a formatted block for a known code", () => {
    const out = explainCode("CHEM-BOND-001");
    expect(out).not.toBeNull();
    const text = out as string;

    expect(text).toContain("Code:     CHEM-BOND-001");
    expect(text).toContain("Level:    error");
    expect(text).toContain("Category: BOND");
    expect(text).toContain("TrKey:    diagnostic.bond_unresolved");
    expect(text).toContain(`${DOC_BASE_URL}#chem-bond-001-bond-unresolved`);
  });

  it("includes the doc link for every code", () => {
    for (const code of Object.keys(DIAGNOSTIC_CODES) as DiagnosticCode[]) {
      const out = explainCode(code);
      expect(out, `explainCode(${code}) returned null`).not.toBeNull();
      expect(out).toContain(DOC_BASE_URL);
    }
  });

  it("returns null for an unknown code", () => {
    expect(explainCode("CHEM-DOES-NOT-EXIST")).toBeNull();
    expect(explainCode("nonsense")).toBeNull();
    expect(explainCode("")).toBeNull();
  });

  it("does NOT include a Status line when the entry is not deprecated", () => {
    const out = explainCode("CHEM-MANIFEST-001");
    expect(out).not.toBeNull();
    expect(out).not.toContain("Status:");
    expect(out).not.toContain("deprecated");
  });
});

describe("formatExplainBlock", () => {
  it("formats a deprecated entry with its replacement", () => {
    const out = formatExplainBlock({
      code: "CHEM-BOND-001",
      category: "BOND",
      level: "error",
      trKey: "diagnostic.bond_unresolved",
      helpFragment: "x",
      deprecated: { since: "1.2.0", replacement: "CHEM-BOND-002" },
    });
    expect(out).toContain("Status:   deprecated since 1.2.0");
    expect(out).toContain("(replaced by CHEM-BOND-002)");
  });

  it("formats a deprecated entry without a replacement", () => {
    const out = formatExplainBlock({
      code: "CHEM-BOND-001",
      category: "BOND",
      level: "error",
      trKey: "diagnostic.bond_unresolved",
      helpFragment: "x",
      deprecated: { since: "1.2.0" },
    });
    expect(out).toContain("Status:   deprecated since 1.2.0");
    expect(out).not.toContain("replaced by");
  });
});

describe("docLinkFor / knownCode", () => {
  it("docLinkFor builds a URL with the helpFragment anchor", () => {
    const meta = DIAGNOSTIC_CODES["CHEM-BOND-001"];
    expect(docLinkFor(meta)).toBe(`${DOC_BASE_URL}#${meta.helpFragment}`);
  });

  it("knownCode is true for registered codes and false otherwise", () => {
    expect(knownCode("CHEM-BOND-001")).toBe(true);
    expect(knownCode("CHEM-DOES-NOT-EXIST")).toBe(false);
    expect(knownCode("")).toBe(false);
  });
});
