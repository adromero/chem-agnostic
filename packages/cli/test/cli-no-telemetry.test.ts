// Tests for the global --no-telemetry flag and stripTelemetryFlag.
// Mirror the pattern of cli-no-cache.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCli, stripTelemetryFlag } from "../src/cli.js";
import { __resetCacheStateForTesting, isCacheEnabled, setCacheEnabled } from "@chemag/core/cache";
import * as checkCmd from "../src/commands/check.js";
import { __resetForTesting } from "@chemag/core/vocabulary";
import {
  __resetTelemetryRunStateForTesting,
  getConfigPath,
  getTelemetryRunOverride,
  loadConfig,
  makeOptInConfig,
  saveConfig,
} from "@chemag/telemetry";

let tmpDir: string;
let chemagConfigDir: string;
let prevConfigHome: string | undefined;
let stdout: string[];
let stderr: string[];
let exitCode: number | undefined;

beforeEach(() => {
  __resetForTesting();
  __resetCacheStateForTesting();
  __resetTelemetryRunStateForTesting();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-no-tel-"));
  chemagConfigDir = path.join(tmpDir, "chemag-cfg");
  prevConfigHome = process.env.CHEMAG_CONFIG_HOME;
  process.env.CHEMAG_CONFIG_HOME = chemagConfigDir;
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
  __resetTelemetryRunStateForTesting();
  if (prevConfigHome === undefined) delete process.env.CHEMAG_CONFIG_HOME;
  else process.env.CHEMAG_CONFIG_HOME = prevConfigHome;
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
// stripTelemetryFlag — pure unit
// ---------------------------------------------------------------------------

describe("stripTelemetryFlag", () => {
  it("removes --no-telemetry and preserves the rest", () => {
    expect(stripTelemetryFlag(["check", "--no-telemetry", "--manifest-only"])).toEqual([
      "check",
      "--manifest-only",
    ]);
  });

  it("is a no-op when --no-telemetry is absent", () => {
    expect(stripTelemetryFlag(["check", "--manifest-only", "ws.yaml"])).toEqual([
      "check",
      "--manifest-only",
      "ws.yaml",
    ]);
  });

  it("removes every occurrence", () => {
    expect(stripTelemetryFlag(["--no-telemetry", "check", "--no-telemetry", "ws.yaml"])).toEqual([
      "check",
      "ws.yaml",
    ]);
  });

  it("leaves unrelated flags alone (composes with --no-cache and --vocabulary)", () => {
    expect(
      stripTelemetryFlag([
        "check",
        "--vocabulary",
        "chemistry",
        "--no-cache",
        "--no-telemetry",
        "--manifest-only",
        "ws.yaml",
      ]),
    ).toEqual(["check", "--vocabulary", "chemistry", "--no-cache", "--manifest-only", "ws.yaml"]);
  });
});

// ---------------------------------------------------------------------------
// runCli wiring — toggles the run override and strips before dispatch
// ---------------------------------------------------------------------------

describe("runCli + --no-telemetry", () => {
  it("setTelemetryEnabledForRun(false) is applied; getTelemetryRunOverride() === false", () => {
    const wsPath = writeMinimalWorkspace();
    const cmdSpy = vi.spyOn(checkCmd, "cmdCheck").mockImplementation((_argv: string[]): void => {
      expect(getTelemetryRunOverride()).toBe(false);
    });

    runSafe(["check", "--no-telemetry", "--manifest-only", wsPath]);

    expect(cmdSpy).toHaveBeenCalledTimes(1);
    const received = cmdSpy.mock.calls[0]?.[0];
    expect(received).not.toContain("--no-telemetry");
    expect(received).toContain("--manifest-only");
  });

  it("default invocation leaves the override untouched (null)", () => {
    const wsPath = writeMinimalWorkspace();
    const cmdSpy = vi.spyOn(checkCmd, "cmdCheck").mockImplementation((_argv: string[]): void => {
      expect(getTelemetryRunOverride()).toBeNull();
    });

    runSafe(["check", "--manifest-only", wsPath]);

    expect(cmdSpy).toHaveBeenCalledTimes(1);
  });

  it("--no-telemetry composes with --no-cache and --vocabulary", () => {
    const wsPath = writeMinimalWorkspace();
    const cmdSpy = vi.spyOn(checkCmd, "cmdCheck").mockImplementation((_argv: string[]): void => {
      expect(getTelemetryRunOverride()).toBe(false);
      expect(isCacheEnabled()).toBe(false);
    });

    runSafe([
      "check",
      "--vocabulary",
      "chemistry",
      "--no-cache",
      "--no-telemetry",
      "--manifest-only",
      wsPath,
    ]);

    expect(cmdSpy).toHaveBeenCalledTimes(1);
    const received = cmdSpy.mock.calls[0]?.[0];
    expect(received).not.toContain("--no-telemetry");
    expect(received).not.toContain("--no-cache");
    expect(received).not.toContain("--vocabulary");
  });
});

// ---------------------------------------------------------------------------
// --no-telemetry must NOT mutate ~/.config/chemag/config.json
// ---------------------------------------------------------------------------

describe("--no-telemetry leaves the persistent config alone", () => {
  it("with consent ON, --no-telemetry does NOT flip the file value to false", () => {
    saveConfig(makeOptInConfig());
    const before = loadConfig();
    expect(before?.telemetry.enabled).toBe(true);

    const wsPath = writeMinimalWorkspace();
    vi.spyOn(checkCmd, "cmdCheck").mockImplementation((_argv: string[]): void => {});

    runSafe(["check", "--no-telemetry", "--manifest-only", wsPath]);

    const after = loadConfig();
    expect(after?.telemetry.enabled).toBe(true);
    expect(after?.telemetry.anonymousId).toBe(before?.telemetry.anonymousId);
  });

  it("with no config file, --no-telemetry does NOT create one", () => {
    const wsPath = writeMinimalWorkspace();
    vi.spyOn(checkCmd, "cmdCheck").mockImplementation((_argv: string[]): void => {});

    expect(fs.existsSync(getConfigPath())).toBe(false);
    runSafe(["check", "--no-telemetry", "--manifest-only", wsPath]);
    expect(fs.existsSync(getConfigPath())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// help output mentions --no-telemetry
// ---------------------------------------------------------------------------

describe("printHelp mentions --no-telemetry", () => {
  it("standard --help contains --no-telemetry", () => {
    runSafe(["--vocabulary", "standard", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("--no-telemetry");
  });

  it("chemistry --help contains --no-telemetry", () => {
    runSafe(["--vocabulary", "chemistry", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("--no-telemetry");
  });
});

void setCacheEnabled;
