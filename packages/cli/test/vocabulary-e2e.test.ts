// End-to-end vocabulary precedence: run actual commands (init, check) on
// a real temp workspace with various flag/env/workspace.yaml combinations
// and verify the rendered diagnostic messages match the expected locale.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { cmdCheck } from "../src/commands/check.js";
import { runCli } from "../src/cli.js";
import { __resetForTesting } from "@chemag/core/vocabulary";

let tmpDir: string;
let stdout: string[];
let stderr: string[];
let exitCode: number | undefined;

function captureCmd(): void {
  stdout = [];
  stderr = [];
  exitCode = undefined;

  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode = code;
    throw new Error("__exit__");
  }) as never);
  vi.spyOn(console, "log").mockImplementation((...a: any[]) => {
    stdout.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: any[]) => {
    stderr.push(a.join(" "));
  });
}

function safeRun(fn: () => void): void {
  try {
    fn();
  } catch (e: any) {
    if (e.message !== "__exit__") throw e;
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-vocab-e2e-"));
  __resetForTesting();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers — write a workspace.yaml + a single compound that triggers a
// bond violation diagnostic. The exact wording of the bond violation
// message changes between locales, which is what we assert on.
// ---------------------------------------------------------------------------

function writeBrokenWorkspace(opts: { vocabulary?: "standard" | "chemistry" } = {}): string {
  const wsYaml = `workspace: testbench
language: typescript

${opts.vocabulary ? `vocabulary: ${opts.vocabulary}\n` : ""}roles:
  element: { description: V, folder: elements }
  reaction: { description: W, folder: reactions }

bonds:
  element: [element]
  reaction: [element, reaction]

paths:
  compounds: ./src/compounds
`;
  const wsPath = path.join(tmpDir, "workspace.yaml");
  fs.writeFileSync(wsPath, wsYaml, "utf-8");

  const compoundDir = path.join(tmpDir, "src", "compounds", "billing");
  fs.mkdirSync(compoundDir, { recursive: true });

  // A compound that has a bond-violation: an element depends on a reaction.
  const compoundYaml = `compound: billing
units:
  - role: reaction
    name: doIt
    file: ./reactions/doIt.ts
  - role: element
    name: BadId
    file: ./elements/BadId.ts
    depends_on: [doIt]
`;
  fs.writeFileSync(path.join(compoundDir, "compound.yaml"), compoundYaml, "utf-8");

  return wsPath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("end-to-end vocabulary precedence", () => {
  it("default vocabulary (standard) emits 'dependency rule violation'", () => {
    const wsPath = writeBrokenWorkspace();
    captureCmd();
    safeRun(() => cmdCheck(["--manifest-only", wsPath]));
    const out = stdout.join("\n");
    expect(exitCode).toBe(1);
    expect(out).toContain("dependency rule violation");
  });

  it("workspace.vocabulary: chemistry emits 'bond violation'", () => {
    const wsPath = writeBrokenWorkspace({ vocabulary: "chemistry" });
    captureCmd();
    safeRun(() => cmdCheck(["--manifest-only", wsPath]));
    const out = stdout.join("\n");
    expect(exitCode).toBe(1);
    expect(out).toContain("bond violation");
    expect(out).not.toContain("dependency rule violation");
  });

  it("--vocabulary chemistry flag wins over standard workspace value", () => {
    const wsPath = writeBrokenWorkspace({ vocabulary: "standard" });
    captureCmd();
    safeRun(() => runCli(["check", "--vocabulary", "chemistry", "--manifest-only", wsPath]));
    const out = stdout.join("\n");
    expect(exitCode).toBe(1);
    expect(out).toContain("bond violation");
  });

  it("--vocabulary standard flag wins over chemistry workspace value", () => {
    const wsPath = writeBrokenWorkspace({ vocabulary: "chemistry" });
    captureCmd();
    safeRun(() => runCli(["check", "--vocabulary", "standard", "--manifest-only", wsPath]));
    const out = stdout.join("\n");
    expect(exitCode).toBe(1);
    expect(out).toContain("dependency rule violation");
    expect(out).not.toContain("bond violation");
  });

  it("CHEMAG_VOCABULARY env wins over workspace value", () => {
    const wsPath = writeBrokenWorkspace({ vocabulary: "standard" });
    const prev = process.env.CHEMAG_VOCABULARY;
    process.env.CHEMAG_VOCABULARY = "chemistry";
    try {
      captureCmd();
      safeRun(() => runCli(["check", "--manifest-only", wsPath]));
      const out = stdout.join("\n");
      expect(exitCode).toBe(1);
      expect(out).toContain("bond violation");
    } finally {
      if (prev === undefined) delete process.env.CHEMAG_VOCABULARY;
      else process.env.CHEMAG_VOCABULARY = prev;
    }
  });

  it("CLI flag wins over CHEMAG_VOCABULARY env", () => {
    const wsPath = writeBrokenWorkspace();
    const prev = process.env.CHEMAG_VOCABULARY;
    process.env.CHEMAG_VOCABULARY = "chemistry";
    try {
      captureCmd();
      safeRun(() => runCli(["check", "--vocabulary", "standard", "--manifest-only", wsPath]));
      const out = stdout.join("\n");
      expect(exitCode).toBe(1);
      expect(out).toContain("dependency rule violation");
    } finally {
      if (prev === undefined) delete process.env.CHEMAG_VOCABULARY;
      else process.env.CHEMAG_VOCABULARY = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// Loader rejects invalid workspace.vocabulary values
// ---------------------------------------------------------------------------

describe("loader rejects invalid workspace.vocabulary", () => {
  it("throws on an unknown vocabulary value", () => {
    const wsPath = path.join(tmpDir, "workspace.yaml");
    fs.writeFileSync(
      wsPath,
      `workspace: x
language: typescript
vocabulary: klingon
roles:
  element: { description: V, folder: elements }
bonds:
  element: [element]
paths:
  compounds: ./src
`,
      "utf-8",
    );

    captureCmd();
    safeRun(() => cmdCheck([wsPath]));
    expect(exitCode).toBe(2);
    const errs = stderr.join("\n");
    expect(errs.toLowerCase()).toContain("invalid");
    expect(errs).toContain("vocabulary");
  });
});
