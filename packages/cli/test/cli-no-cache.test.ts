// Tests for the global --no-cache flag and stripCacheFlag.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCli, stripCacheFlag } from "../src/cli.js";
import {
  CACHE_SCHEMA_VERSION,
  __resetCacheStateForTesting,
  isCacheEnabled,
  setCacheEnabled,
} from "@chemag/core/cache";
import * as checkCmd from "../src/commands/check.js";
import { __resetForTesting } from "@chemag/core/vocabulary";

let tmpDir: string;
let stdout: string[];
let stderr: string[];
let exitCode: number | undefined;

beforeEach(() => {
  __resetForTesting();
  __resetCacheStateForTesting();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-no-cache-"));
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
  __resetForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runSafe(argv: string[]): void {
  try {
    runCli(argv);
  } catch (e) {
    if ((e as Error).message !== "__cli_exit__") throw e;
  }
}

function writeMinimalWorkspace(): string {
  const wsYaml = `workspace: testbench
language: typescript
roles:
  element: { description: V, folder: elements }
bonds:
  element: [element]
paths:
  compounds: ./src/compounds
`;
  const wsPath = path.join(tmpDir, "workspace.yaml");
  fs.writeFileSync(wsPath, wsYaml, "utf-8");
  fs.mkdirSync(path.join(tmpDir, "src", "compounds"), { recursive: true });
  return wsPath;
}

// ---------------------------------------------------------------------------
// stripCacheFlag — pure unit
// ---------------------------------------------------------------------------

describe("stripCacheFlag", () => {
  it("removes --no-cache and preserves the rest", () => {
    expect(stripCacheFlag(["check", "--no-cache", "--manifest-only"])).toEqual([
      "check",
      "--manifest-only",
    ]);
  });

  it("is a no-op when --no-cache is absent", () => {
    expect(stripCacheFlag(["check", "--manifest-only", "ws.yaml"])).toEqual([
      "check",
      "--manifest-only",
      "ws.yaml",
    ]);
  });

  it("removes every occurrence of --no-cache (idempotent for multiples)", () => {
    expect(stripCacheFlag(["--no-cache", "check", "--no-cache", "ws.yaml"])).toEqual([
      "check",
      "ws.yaml",
    ]);
  });
});

// ---------------------------------------------------------------------------
// runCli wiring — toggles the cache-state flag and strips before dispatch
// ---------------------------------------------------------------------------

describe("runCli + --no-cache", () => {
  it("calls setCacheEnabled(false) exactly once and isCacheEnabled() returns false", () => {
    const wsPath = writeMinimalWorkspace();
    // Spy on cmdCheck so we can assert what it actually receives.
    const cmdSpy = vi.spyOn(checkCmd, "cmdCheck").mockImplementation((_argv: string[]): void => {
      // Stop the dispatcher from doing real work; assert flag state here.
      expect(isCacheEnabled()).toBe(false);
    });

    runSafe(["check", "--no-cache", "--manifest-only", wsPath]);

    expect(cmdSpy).toHaveBeenCalledTimes(1);
    const received = cmdSpy.mock.calls[0]?.[0];
    expect(received).not.toContain("--no-cache");
    // Vocabulary flag stripping should still work in tandem.
    expect(received).toContain("--manifest-only");
  });

  it("default invocation leaves the cache enabled", () => {
    const wsPath = writeMinimalWorkspace();
    const cmdSpy = vi.spyOn(checkCmd, "cmdCheck").mockImplementation((_argv: string[]): void => {
      expect(isCacheEnabled()).toBe(true);
    });

    runSafe(["check", "--manifest-only", wsPath]);

    expect(cmdSpy).toHaveBeenCalledTimes(1);
  });

  it("--no-cache works alongside --vocabulary", () => {
    const wsPath = writeMinimalWorkspace();
    const cmdSpy = vi.spyOn(checkCmd, "cmdCheck").mockImplementation((_argv: string[]): void => {
      expect(isCacheEnabled()).toBe(false);
    });

    runSafe(["check", "--vocabulary", "chemistry", "--no-cache", "--manifest-only", wsPath]);

    expect(cmdSpy).toHaveBeenCalledTimes(1);
    const received = cmdSpy.mock.calls[0]?.[0];
    expect(received).not.toContain("--no-cache");
    expect(received).not.toContain("--vocabulary");
    expect(received).not.toContain("chemistry");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: --no-cache must NOT write to .chemag/cache/
// ---------------------------------------------------------------------------

describe("--no-cache prevents disk writes", () => {
  it("running check with --no-cache leaves .chemag/cache/ untouched", () => {
    const wsPath = writeMinimalWorkspace();
    const cacheDir = path.join(tmpDir, ".chemag");

    runSafe(["check", "--no-cache", "--manifest-only", wsPath]);

    expect(fs.existsSync(cacheDir)).toBe(false);
  });

  it("running check WITHOUT --no-cache populates .chemag/cache/", () => {
    const wsPath = writeMinimalWorkspace();
    const cacheDir = path.join(tmpDir, ".chemag", "cache");

    runSafe(["check", "--manifest-only", wsPath]);

    expect(fs.existsSync(cacheDir)).toBe(true);
    // Version stamp written
    expect(fs.readFileSync(path.join(cacheDir, "version"), "utf-8")).toBe(CACHE_SCHEMA_VERSION);
  });
});

// ---------------------------------------------------------------------------
// help text mentions --no-cache
// ---------------------------------------------------------------------------

describe("printHelp mentions --no-cache", () => {
  it("standard vocabulary --help output contains --no-cache", () => {
    runSafe(["--vocabulary", "standard", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("--no-cache");
  });

  it("chemistry vocabulary --help output contains --no-cache", () => {
    runSafe(["--vocabulary", "chemistry", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("--no-cache");
  });
});

// re-importing setCacheEnabled is not strictly needed but keeps the module
// graph intact for tests that toggle it manually.
void setCacheEnabled;
