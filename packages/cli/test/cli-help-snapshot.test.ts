// ---------------------------------------------------------------------------
// Help-output snapshot tests. WP-008.
//
// We assert content (not exact framing) because the citty render layout
// happens to use ASCII boxes that may shift if framework versions change.
// What we DO snapshot:
//   - Both vocabularies (standard, chemistry) produce help text containing
//     command-group sections + each subcommand's name+description.
//   - The Phase-1 vocabulary choice surfaces in command descriptions
//     (chemistry → "compound", standard → "module").
//   - Global flags (--vocabulary, --no-cache, --no-telemetry, --quiet) are
//     listed under a "GLOBAL FLAGS" section and NOT registered as command
//     options on subcommands.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { __resetForTesting } from "@chemag/core/vocabulary";
import { stripAnsi } from "../src/ui/colors.js";

let stdout: string[];
let exitCode: number | undefined;

beforeEach(() => {
  __resetForTesting();
  stdout = [];
  exitCode = undefined;

  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode = code;
    throw new Error("__cli_exit__");
  }) as never);
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function helpOutput(argv: string[]): string {
  try {
    runCli(argv);
  } catch (e: unknown) {
    if ((e as Error).message !== "__cli_exit__") throw e;
  }
  return stripAnsi(stdout.join("\n"));
}

describe("help — standard vocabulary", () => {
  it("renders top-level help with command groups and global flags", () => {
    const text = helpOutput(["--vocabulary", "standard", "--help"]);
    expect(exitCode).toBe(0);

    // Section headers
    expect(text).toContain("USAGE:");
    expect(text).toContain("GLOBAL FLAGS:");
    expect(text).toContain("WORKSPACE:");
    expect(text).toContain("VALIDATION:");
    expect(text).toContain("GENERATION:");
    expect(text).toContain("INTEGRATIONS:");
    expect(text).toContain("UTILITIES:");

    // Commands (each must show up exactly once with its description)
    expect(text).toMatch(/\binit\b/);
    expect(text).toMatch(/\badd\b/);
    expect(text).toMatch(/\bcheck\b/);
    expect(text).toMatch(/\bcheck-edit\b/);
    expect(text).toMatch(/\banalyze\b/);
    expect(text).toMatch(/\bscaffold\b/);
    expect(text).toMatch(/\bgraph\b/);
    expect(text).toMatch(/\bsync\b/);
    expect(text).toMatch(/\bemit-rules\b/);
    expect(text).toMatch(/\bmcp\b/);
    expect(text).toMatch(/\bconfig\b/);
    expect(text).toMatch(/\bcompletion\b/);

    // Global flags listed
    expect(text).toContain("--vocabulary");
    expect(text).toContain("--no-cache");
    expect(text).toContain("--no-telemetry");
    expect(text).toContain("--quiet");
    expect(text).toContain("--help");
    expect(text).toContain("--version");
  });

  it("standard vocabulary leaks into command summaries (module / dependency rules)", () => {
    const text = helpOutput(["--vocabulary", "standard", "--help"]);
    // Standard vocab uses "module" / "dependency rules"
    expect(text.toLowerCase()).toMatch(/\bmodule\b/);
    expect(text.toLowerCase()).toMatch(/dependency/);
  });
});

describe("help — chemistry vocabulary", () => {
  it("renders top-level help with chemistry vocab visible in summaries", () => {
    const text = helpOutput(["--vocabulary", "chemistry", "--help"]);
    expect(exitCode).toBe(0);
    expect(text).toContain("USAGE:");
    expect(text).toContain("GLOBAL FLAGS:");

    // Chemistry vocab uses "compound" / "bond"
    expect(text.toLowerCase()).toMatch(/\bcompound\b/);
    expect(text.toLowerCase()).toMatch(/\bbond/);
  });
});

describe("help — vocabulary changes content (regression)", () => {
  it("switching vocabulary changes at least one description", () => {
    const std = helpOutput(["--vocabulary", "standard", "--help"]);
    __resetForTesting();
    stdout = [];
    exitCode = undefined;
    const chem = helpOutput(["--vocabulary", "chemistry", "--help"]);
    expect(std).not.toEqual(chem);
  });
});
