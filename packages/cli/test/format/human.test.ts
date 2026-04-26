// ---------------------------------------------------------------------------
// Tests for the human (ANSI) formatter. We assert on ANSI-stripped content so
// the snapshots are stable across environments (the CI may strip colours).
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest";
import { formatHuman } from "../../src/format/human.js";
import {
  makeAnalyzeContext,
  makeCheckContext,
  makeCheckEditContext,
  sourceLevelDiag,
  warningDiag,
} from "./fixtures.js";

// `\x1b[…m` ANSI escape sequence — biome flags the literal control character
// in a regex, so we build it from a hex escape instead.
const ANSI_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");
const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");

describe("format/human — check command", () => {
  it("renders a clean run with the workspace name and totals", () => {
    const out = stripAnsi(
      formatHuman([], makeCheckContext({ checks: [{ check: "manifest", diagnostics: [] }] })),
    );
    expect(out).toContain("chemtest check");
    expect(out).toContain("Workspace: test-app");
    expect(out).toMatch(/All\s+\d+\s+checks passed/);
  });

  it("prints per-check pass/fail markers and message lines", () => {
    const ctx = makeCheckContext({
      checks: [
        { check: "manifest", diagnostics: [] },
        { check: "import-bonds", diagnostics: [sourceLevelDiag()] },
      ],
    });
    const out = stripAnsi(formatHuman([sourceLevelDiag()], ctx));
    expect(out).toContain("✓");
    expect(out).toContain("✗  import-bonds");
    expect(out).toContain("error: orders > createOrder.ts");
    expect(out).toMatch(/1 check failed/);
  });

  it("emits a hint line when present", () => {
    const ctx = makeCheckContext({
      checks: [{ check: "import-bonds", diagnostics: [sourceLevelDiag()] }],
    });
    const out = stripAnsi(formatHuman([sourceLevelDiag()], ctx));
    expect(out).toContain("reaction can only import");
  });

  it("warnings count is shown in the failure summary", () => {
    const ctx = makeCheckContext({
      checks: [
        { check: "import-bonds", diagnostics: [sourceLevelDiag()] },
        { check: "public-surface", diagnostics: [warningDiag()] },
      ],
    });
    const out = stripAnsi(formatHuman([sourceLevelDiag(), warningDiag()], ctx));
    expect(out).toMatch(/1 warning/);
  });
});

describe("format/human — analyze command", () => {
  it("groups diagnostics under import-bonds / import-bypass / import-undeclared", () => {
    const ctx = makeAnalyzeContext();
    const out = stripAnsi(formatHuman([sourceLevelDiag()], ctx));
    expect(out).toContain("chemtest analyze");
    expect(out).toContain("import-bonds");
    expect(out).toContain("import-bypass");
    expect(out).toContain("import-undeclared");
  });

  it("emits 'All imports valid' when there are no errors", () => {
    const out = stripAnsi(formatHuman([], makeAnalyzeContext()));
    expect(out).toContain("All imports valid");
  });
});

describe("format/human — check-edit command", () => {
  it("prints File / Compound / Role headers", () => {
    const out = stripAnsi(formatHuman([], makeCheckEditContext()));
    expect(out).toContain("chemag check-edit");
    expect(out).toContain("File:");
    expect(out).toContain("Compound: orders");
    expect(out).toContain("Role: reaction");
    expect(out).toContain("no diagnostics");
  });

  it("renders code in [brackets] before the message", () => {
    const out = stripAnsi(formatHuman([sourceLevelDiag()], makeCheckEditContext()));
    expect(out).toContain("[CHEM-BOND-003]");
  });
});

describe("format/human — output ends with newline", () => {
  it("check", () => {
    const ctx = makeCheckContext({ checks: [] });
    expect(formatHuman([], ctx).endsWith("\n")).toBe(true);
  });
  it("analyze", () => {
    expect(formatHuman([], makeAnalyzeContext()).endsWith("\n")).toBe(true);
  });
  it("check-edit", () => {
    expect(formatHuman([], makeCheckEditContext()).endsWith("\n")).toBe(true);
  });
});
