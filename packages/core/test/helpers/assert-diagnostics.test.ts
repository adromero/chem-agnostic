import { describe, it, expect } from "vitest";
import { assertDiagnosticCodes } from "./assert-diagnostics.js";
import type { Diagnostic, DiagnosticCode } from "../../src/types.js";

function diag(code: DiagnosticCode, extra: Partial<Diagnostic> = {}): Diagnostic {
  return {
    level: "error",
    check: "test",
    code,
    message: `msg-${code}`,
    ...extra,
  };
}

describe("assertDiagnosticCodes", () => {
  describe("exact-match mode", () => {
    it("passes when the multiset of actual codes equals expected", () => {
      const diags = [diag("CHEM-MANIFEST-001"), diag("CHEM-MANIFEST-001"), diag("CHEM-ROLE-001")];
      expect(() =>
        assertDiagnosticCodes(diags, {
          codes: ["CHEM-MANIFEST-001", "CHEM-MANIFEST-001", "CHEM-ROLE-001"],
        }),
      ).not.toThrow();
    });

    it("passes when the empty multiset matches an empty expectation", () => {
      expect(() => assertDiagnosticCodes([], { codes: [] })).not.toThrow();
    });

    it("throws when an expected code is missing from the actual list", () => {
      const diags = [diag("CHEM-MANIFEST-001")];
      let err: Error | undefined;
      try {
        assertDiagnosticCodes(diags, { codes: ["CHEM-ROLE-001"] });
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeDefined();
      expect(err!.message).toContain("CHEM-ROLE-001");
      expect(err!.message).toContain("CHEM-MANIFEST-001");
      expect(err!.message).toContain("expected codes");
      expect(err!.message).toContain("actual codes");
    });

    it("throws when multiplicity differs (actual has extra duplicate)", () => {
      const diags = [diag("CHEM-MANIFEST-001"), diag("CHEM-MANIFEST-001")];
      expect(() => assertDiagnosticCodes(diags, { codes: ["CHEM-MANIFEST-001"] })).toThrowError(
        /CHEM-MANIFEST-001 \(x2\)/,
      );
    });
  });

  describe("bounded mode — minCount", () => {
    it("passes when total >= minCount and required codes present", () => {
      const diags = [diag("CHEM-MANIFEST-001"), diag("CHEM-ROLE-001"), diag("CHEM-PLACEMENT-001")];
      expect(() =>
        assertDiagnosticCodes(diags, { codes: ["CHEM-MANIFEST-001"], minCount: 2 }),
      ).not.toThrow();
    });

    it("throws when total < minCount", () => {
      const diags = [diag("CHEM-MANIFEST-001")];
      expect(() =>
        assertDiagnosticCodes(diags, { codes: ["CHEM-MANIFEST-001"], minCount: 3 }),
      ).toThrowError(/minCount: 3/);
    });

    it("throws when a required code is missing under bounded mode", () => {
      const diags = [diag("CHEM-ROLE-001"), diag("CHEM-ROLE-001")];
      expect(() =>
        assertDiagnosticCodes(diags, { codes: ["CHEM-MANIFEST-001"], minCount: 1 }),
      ).toThrowError(/CHEM-MANIFEST-001/);
    });
  });

  describe("bounded mode — maxCount", () => {
    it("passes when total <= maxCount and required codes present", () => {
      const diags = [diag("CHEM-MANIFEST-001")];
      expect(() =>
        assertDiagnosticCodes(diags, { codes: ["CHEM-MANIFEST-001"], maxCount: 5 }),
      ).not.toThrow();
    });

    it("throws when total > maxCount", () => {
      const diags = [diag("CHEM-MANIFEST-001"), diag("CHEM-MANIFEST-001"), diag("CHEM-ROLE-001")];
      expect(() =>
        assertDiagnosticCodes(diags, { codes: ["CHEM-MANIFEST-001"], maxCount: 2 }),
      ).toThrowError(/maxCount: 2/);
    });
  });

  describe("failure message includes file:line context", () => {
    it("renders `at <file>:<line>` for each located diagnostic", () => {
      const diags = [
        diag("CHEM-BOND-001", { file: "/tmp/a/elements/X.ts", line: 7 }),
        diag("CHEM-BOND-001", { file: "/tmp/b/molecules/Y.ts", line: 12 }),
      ];
      let err: Error | undefined;
      try {
        assertDiagnosticCodes(diags, { codes: ["CHEM-ROLE-001"] });
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeDefined();
      expect(err!.message).toContain("locations:");
      expect(err!.message).toContain("CHEM-BOND-001 at /tmp/a/elements/X.ts:7");
      expect(err!.message).toContain("CHEM-BOND-001 at /tmp/b/molecules/Y.ts:12");
    });
  });
});
