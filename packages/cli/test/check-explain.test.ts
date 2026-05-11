// ---------------------------------------------------------------------------
// CLI tests for `chemag check --explain CHEM-XXX-NNN`. The flag short-circuits
// before any workspace resolution — these tests verify that contract by
// spying on loadWorkspace and asserting it was never called.
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import * as loader from "@chemag/core/loader";
import { __resetForTesting } from "@chemag/core/vocabulary";

let stdout: string[];
let stderr: string[];
let exitCode: number | undefined;

beforeEach(() => {
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
});

function run(argv: string[]): void {
  try {
    runCli(argv);
  } catch (e: unknown) {
    if ((e as Error).message !== "__cli_exit__") throw e;
  }
}

describe("chemag check --explain", () => {
  it("succeeds (exit 0) without a workspace argument and prints the explain block", () => {
    const spy = vi.spyOn(loader, "loadWorkspace");
    run(["check", "--explain", "CHEM-BOND-001"]);

    expect(exitCode).toBe(0);
    expect(spy).not.toHaveBeenCalled();

    const text = stdout.join("\n");
    expect(text).toContain("CHEM-BOND-001");
    expect(text).toContain("Level:");
    expect(text).toContain("Category: BOND");
    expect(text).toContain("TrKey:    diagnostic.bond_unresolved");
    expect(text).toMatch(/Docs:\s+https?:\/\//);
  });

  it("ignores any trailing positional and never calls loadWorkspace", () => {
    const spy = vi.spyOn(loader, "loadWorkspace");
    run(["check", "--explain", "CHEM-BOND-001", "path/to/workspace.yaml"]);

    expect(exitCode).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(stdout.join("\n")).toContain("CHEM-BOND-001");
  });

  it("exits non-zero with a clear error for an unknown code", () => {
    const spy = vi.spyOn(loader, "loadWorkspace");
    run(["check", "--explain", "UNKNOWN-CODE"]);

    expect(exitCode).toBe(2);
    expect(spy).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toMatch(/unknown diagnostic code/i);
    expect(stderr.join("\n")).toContain("UNKNOWN-CODE");
  });

  it("exits non-zero when --explain is given with no argument", () => {
    const spy = vi.spyOn(loader, "loadWorkspace");
    run(["check", "--explain"]);

    expect(exitCode).toBe(2);
    expect(spy).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toMatch(/--explain requires a code argument/i);
  });

  it("works for codes from every category sampled here", () => {
    for (const code of [
      "CHEM-MANIFEST-001",
      "CHEM-MANIFEST-005",
      "CHEM-ROLE-001",
      "CHEM-PLACEMENT-003",
      "CHEM-PUBLIC-001",
      "CHEM-EXPORT-001",
      "CHEM-IMPORT-002",
      "CHEM-TYPE-001",
      "CHEM-BOND-002",
      "CHEM-SIGNAL-001",
      "CHEM-WIRING-004",
      "CHEM-ASSAY-002",
      "CHEM-PORT-001",
      "CHEM-PORT-003",
    ]) {
      // Each iteration needs its own spy/output reset.
      stdout = [];
      stderr = [];
      exitCode = undefined;
      const spy = vi.spyOn(loader, "loadWorkspace");
      run(["check", "--explain", code]);
      expect(exitCode).toBe(0);
      expect(spy).not.toHaveBeenCalled();
      expect(stdout.join("\n")).toContain(code);
    }
  });
});
