// Tests for the cli.ts dispatcher itself: Phase-1 vocabulary resolution,
// --help/--version exit paths, and the invariant that --help / --version
// never call loadWorkspace.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runCli } from "../src/cli.js";
import * as loader from "@chemag/core/loader";
import { __resetForTesting, getVocabulary, getVocabularySource } from "@chemag/core/vocabulary";

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
  vi.spyOn(console, "log").mockImplementation((...a: any[]) => {
    stdout.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: any[]) => {
    stderr.push(a.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function run(argv: string[]): void {
  try {
    runCli(argv);
  } catch (e: any) {
    if (e.message !== "__cli_exit__") throw e;
  }
}

// ---------------------------------------------------------------------------
// Phase 1 — flag/env/default resolution before dispatch
// ---------------------------------------------------------------------------

describe("runCli — Phase 1 vocabulary resolution", () => {
  it("--vocabulary chemistry sets vocabulary to chemistry with source=flag", () => {
    run(["--vocabulary", "chemistry", "--help"]);
    expect(getVocabulary()).toBe("chemistry");
    expect(getVocabularySource()).toBe("flag");
  });

  it("--vocabulary=standard works with the equals-form", () => {
    run(["--vocabulary=standard", "--help"]);
    expect(getVocabulary()).toBe("standard");
    expect(getVocabularySource()).toBe("flag");
  });

  it("CHEMAG_VOCABULARY env var is honoured (env > default)", () => {
    const prev = process.env.CHEMAG_VOCABULARY;
    process.env.CHEMAG_VOCABULARY = "chemistry";
    try {
      run(["--help"]);
      expect(getVocabulary()).toBe("chemistry");
      expect(getVocabularySource()).toBe("env");
    } finally {
      if (prev === undefined) delete process.env.CHEMAG_VOCABULARY;
      else process.env.CHEMAG_VOCABULARY = prev;
    }
  });

  it("flag wins over env", () => {
    const prev = process.env.CHEMAG_VOCABULARY;
    process.env.CHEMAG_VOCABULARY = "chemistry";
    try {
      run(["--vocabulary", "standard", "--help"]);
      expect(getVocabulary()).toBe("standard");
      expect(getVocabularySource()).toBe("flag");
    } finally {
      if (prev === undefined) delete process.env.CHEMAG_VOCABULARY;
      else process.env.CHEMAG_VOCABULARY = prev;
    }
  });

  it("falls back to standard/default when nothing is set", () => {
    const prev = process.env.CHEMAG_VOCABULARY;
    delete process.env.CHEMAG_VOCABULARY;
    try {
      run(["--help"]);
      expect(getVocabulary()).toBe("standard");
      expect(getVocabularySource()).toBe("default");
    } finally {
      if (prev !== undefined) process.env.CHEMAG_VOCABULARY = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// --help and --version exit before any loadWorkspace call
// ---------------------------------------------------------------------------

describe("runCli — --help / --version do not load any workspace", () => {
  it("--help exits 0 without calling loadWorkspace", () => {
    const spy = vi.spyOn(loader, "loadWorkspace");
    run(["--help"]);
    expect(exitCode).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("-h exits 0 without calling loadWorkspace", () => {
    const spy = vi.spyOn(loader, "loadWorkspace");
    run(["-h"]);
    expect(exitCode).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("empty argv exits 0 (prints help) without calling loadWorkspace", () => {
    const spy = vi.spyOn(loader, "loadWorkspace");
    run([]);
    expect(exitCode).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("--version exits 0 without calling loadWorkspace", () => {
    const spy = vi.spyOn(loader, "loadWorkspace");
    run(["--version"]);
    expect(exitCode).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("-v exits 0 without calling loadWorkspace", () => {
    const spy = vi.spyOn(loader, "loadWorkspace");
    run(["-v"]);
    expect(exitCode).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("-v + --vocabulary still resolves vocabulary in Phase 1", () => {
    run(["-v", "--vocabulary", "chemistry"]);
    expect(getVocabulary()).toBe("chemistry");
    expect(getVocabularySource()).toBe("flag");
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Help text content — uses Phase 1 vocabulary
// ---------------------------------------------------------------------------

describe("runCli — help text reflects Phase-1 vocabulary", () => {
  it("standard vocabulary help mentions language-agnostic", () => {
    run(["--vocabulary", "standard", "--help"]);
    const out = stdout.join("\n");
    expect(out.toLowerCase()).toContain("language-agnostic");
  });

  it("chemistry vocabulary help mentions Chem", () => {
    run(["--vocabulary", "chemistry", "--help"]);
    const out = stdout.join("\n");
    expect(out).toContain("Chem");
  });
});

// ---------------------------------------------------------------------------
// Unknown command path
// ---------------------------------------------------------------------------

describe("runCli — unknown command", () => {
  it("exits 1 with a helpful error message", () => {
    run(["does-not-exist"]);
    expect(exitCode).toBe(1);
    const errs = stderr.join("\n");
    expect(errs).toContain("Unknown command");
    expect(errs).toContain("does-not-exist");
  });

  it("strips --vocabulary from argv before dispatch", () => {
    // Combination: --vocabulary <name> followed by an unknown command.
    // The vocabulary should be resolved and stripped, the command should
    // be the unknown token (not "chemistry").
    run(["--vocabulary", "chemistry", "garbage-cmd"]);
    expect(exitCode).toBe(1);
    const errs = stderr.join("\n");
    expect(errs).toContain("garbage-cmd");
  });
});
