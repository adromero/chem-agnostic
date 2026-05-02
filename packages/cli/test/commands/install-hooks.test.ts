// ---------------------------------------------------------------------------
// CLI integration tests for `chemag install-hooks`. Covers dry-run, scope
// handling (HOME override), mode selection, the unsupported-tool error path,
// and the help blurb.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { __resetForTesting } from "@chemag/core/vocabulary";
import { cmdInstallHooks } from "../../src/commands/install-hooks.js";

let tmpDir: string;
let stdout: string[];
let stderr: string[];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-install-hooks-cli-"));
  __resetForTesting();
  stdout = [];
  stderr = [];

  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  __resetForTesting();
});

describe("cmdInstallHooks — --dry-run", () => {
  it("prints planned changes to stdout and writes nothing", () => {
    const code = cmdInstallHooks(["--tool", "claude", "--workspace", tmpDir, "--dry-run"]);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, ".claude/settings.json"))).toBe(false);
    const text = stdout.join("\n");
    expect(text).toContain("dry run");
    expect(text).toContain("install-hooks");
  });
});

describe("cmdInstallHooks — happy path (project scope)", () => {
  it("writes settings.json and emits a chemag-tagged entry", () => {
    const code = cmdInstallHooks(["--tool", "claude", "--workspace", tmpDir]);
    expect(code).toBe(0);
    const settingsPath = path.join(tmpDir, ".claude/settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const text = fs.readFileSync(settingsPath, "utf-8");
    expect(text).toContain('"_chemag": true');
    expect(text).toContain('"matcher": "Edit|Write"');
  });
});

describe("cmdInstallHooks — mode dispatch", () => {
  it("--mode warn writes a PreToolUse command including --mode warn", () => {
    cmdInstallHooks(["--tool", "claude", "--workspace", tmpDir, "--mode", "warn"]);
    const text = fs.readFileSync(path.join(tmpDir, ".claude/settings.json"), "utf-8");
    expect(text).toContain("--mode warn");
  });

  it("--mode context-only omits PreToolUse entirely", () => {
    cmdInstallHooks(["--tool", "claude", "--workspace", tmpDir, "--mode", "context-only"]);
    const merged = JSON.parse(fs.readFileSync(path.join(tmpDir, ".claude/settings.json"), "utf-8"));
    expect(merged.hooks.PreToolUse).toBeUndefined();
    expect(merged.hooks.PostToolUse).toBeDefined();
  });
});

describe("cmdInstallHooks — scope routing", () => {
  it("--scope project writes to <workspace>/.claude/settings.json", () => {
    cmdInstallHooks(["--tool", "claude", "--workspace", tmpDir, "--scope", "project"]);
    expect(fs.existsSync(path.join(tmpDir, ".claude/settings.json"))).toBe(true);
  });

  it("--scope user writes to ~/.claude/settings.json (HOME override)", () => {
    const fakeHome = path.join(tmpDir, "home");
    fs.mkdirSync(fakeHome, { recursive: true });
    const prevHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      cmdInstallHooks(["--tool", "claude", "--workspace", tmpDir, "--scope", "user"]);
      expect(fs.existsSync(path.join(fakeHome, ".claude/settings.json"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".claude/settings.json"))).toBe(false);
    } finally {
      if (prevHome !== undefined) {
        process.env.HOME = prevHome;
      } else {
        delete process.env.HOME;
      }
    }
  });
});

describe("cmdInstallHooks — unsupported tool", () => {
  it("returns non-zero for an unknown tool name", () => {
    const code = cmdInstallHooks(["--tool", "bogus", "--workspace", tmpDir]);
    expect(code).toBe(2);
    expect(stderr.join("\n")).toContain("CHEM-INSTALL-HOOKS-001");
  });
});

describe("cmdInstallHooks — cursor without husky surfaces CHEM-INSTALL-HOOKS-007", () => {
  it("returns non-zero with the tool-agnostic husky-not-detected diagnostic", () => {
    // No husky in tmpDir → installer fails 007 with an actionable message.
    fs.writeFileSync(
      path.join(tmpDir, "workspace.yaml"),
      "workspace: x\nlanguage: typescript\nroles:\n  element: { folder: elements }\nbonds:\n  element: []\npaths:\n  compounds: ./src/compounds\n",
    );
    const code = cmdInstallHooks(["--tool", "cursor", "--workspace", tmpDir]);
    expect(code).toBe(2);
    expect(stderr.join("\n")).toContain("CHEM-INSTALL-HOOKS-007");
    expect(stderr.join("\n")).toContain("husky");
  });
});

describe("cmdInstallHooks — uninstall", () => {
  it("--uninstall removes chemag entries", () => {
    cmdInstallHooks(["--tool", "claude", "--workspace", tmpDir]);
    const settingsPath = path.join(tmpDir, ".claude/settings.json");
    expect(fs.readFileSync(settingsPath, "utf-8")).toContain("_chemag");

    const code = cmdInstallHooks(["--tool", "claude", "--workspace", tmpDir, "--uninstall"]);
    expect(code).toBe(0);
    expect(fs.readFileSync(settingsPath, "utf-8")).not.toContain("_chemag");
  });

  it("--uninstall on a fresh workspace surfaces CHEM-INSTALL-HOOKS-005", () => {
    const code = cmdInstallHooks(["--tool", "claude", "--workspace", tmpDir, "--uninstall"]);
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("CHEM-INSTALL-HOOKS-005");
  });
});

describe("cmdInstallHooks — --help", () => {
  it("prints help and exits 0", () => {
    const code = cmdInstallHooks(["--help"]);
    expect(code).toBe(0);
    const text = stdout.join("\n");
    expect(text).toContain("install-hooks");
    expect(text).toContain("--tool");
  });
});

describe("cmdInstallHooks — invalid --scope", () => {
  it("rejects unknown scope value with CHEM-INSTALL-HOOKS-004", () => {
    const code = cmdInstallHooks(["--tool", "claude", "--scope", "global", "--workspace", tmpDir]);
    expect(code).toBe(2);
    expect(stderr.join("\n")).toContain("CHEM-INSTALL-HOOKS-004");
  });
});

// ---------------------------------------------------------------------------
// WP-018: --tool all fan-out
// ---------------------------------------------------------------------------

/**
 * Bootstrap the minimal fixture the fan-out path needs:
 *   - a husky scaffold so husky-dependent installers (cursor/codex/aider/
 *     cline/copilot) don't trip CHEM-INSTALL-HOOKS-007
 *   - a workspace.yaml because the rule emitters resolve the workspace
 */
function bootstrapHuskyFixture(root: string): void {
  fs.mkdirSync(path.join(root, ".husky"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", devDependencies: { husky: "^9.0.0" } }),
  );
  fs.writeFileSync(
    path.join(root, "workspace.yaml"),
    [
      "workspace: fixture",
      "language: typescript",
      "roles:",
      "  element: { description: value object, folder: elements }",
      "bonds:",
      "  element: []",
      "paths:",
      "  compounds: ./src/compounds",
      "rules:",
      "  cross_compound_imports: public_only",
      "  role_from_path: true",
      "  public_surface: public.ts",
      "  manifest_filename: compound.yaml",
      "",
    ].join("\n"),
  );
}

/** Strip ANSI color codes so test regexes can match cell content cleanly. */
function strip(s: string): string {
  // Remove ESC + [ + digits + 'm' (the only ANSI sequences this CLI emits).
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point.
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("cmdInstallHooks — --tool all fan-out (WP-018)", () => {
  it("fresh install across all 6 tools exits 0 and emits a 6-row summary", () => {
    bootstrapHuskyFixture(tmpDir);
    const code = cmdInstallHooks(["--tool", "all", "--workspace", tmpDir]);
    expect(code).toBe(0);

    const text = strip(stdout.join("\n"));
    // Header + 6 tool rows present (deterministic order).
    expect(text).toContain("tool");
    for (const t of ["claude", "cursor", "codex", "aider", "cline", "copilot"]) {
      expect(text).toContain(t);
    }
    // No `error` row on the canonical fixture.
    expect(text).not.toMatch(/\berror\b/);

    // Per-tool artifacts exist.
    expect(fs.existsSync(path.join(tmpDir, ".claude/settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".husky/pre-commit"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".cursor/rules/architecture.mdc"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".aider/CONVENTIONS.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".clinerules"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".github/copilot-instructions.md"))).toBe(true);
  });

  it("idempotent rerun exits 0 and reports no-op rows", () => {
    bootstrapHuskyFixture(tmpDir);
    const first = cmdInstallHooks(["--tool", "all", "--workspace", tmpDir]);
    expect(first).toBe(0);

    // Reset captured output so the second run's table is the only thing we inspect.
    stdout.length = 0;
    stderr.length = 0;

    const second = cmdInstallHooks(["--tool", "all", "--workspace", tmpDir]);
    expect(second).toBe(0);

    const text = strip(stdout.join("\n"));
    // Every tool row reports `no-op` on the second invocation.
    const tools = ["claude", "cursor", "codex", "aider", "cline", "copilot"];
    for (const t of tools) {
      // The row line starts with the tool name; assert the row contains "no-op".
      const rowMatch = text.split("\n").find((line) => line.trim().startsWith(t));
      expect(rowMatch, `expected a row for ${t}`).toBeDefined();
      expect(rowMatch ?? "").toContain("no-op");
    }
  });

  it("partial failure: continues remaining tools and aggregates exit 2", () => {
    // No husky in tmpDir → cursor/codex/aider/cline/copilot all fail
    // CHEM-INSTALL-HOOKS-007. claude succeeds (no husky dependency).
    const code = cmdInstallHooks(["--tool", "all", "--workspace", tmpDir]);
    expect(code).toBe(2);

    const text = strip(stdout.join("\n"));
    // claude row reports ok (it does not require husky).
    const claudeRow = text.split("\n").find((line) => line.trim().startsWith("claude"));
    expect(claudeRow ?? "").toMatch(/\bok\b/);

    // The five husky-dependent tools each report error with code 007.
    for (const t of ["cursor", "codex", "aider", "cline", "copilot"]) {
      const row = text.split("\n").find((line) => line.trim().startsWith(t));
      expect(row, `expected a row for ${t}`).toBeDefined();
      expect(row ?? "").toContain("error");
      expect(row ?? "").toContain("CHEM-INSTALL-HOOKS-007");
    }

    // Claude's settings.json was still created — fan-out kept running after
    // the husky-dependent tools failed.
    expect(fs.existsSync(path.join(tmpDir, ".claude/settings.json"))).toBe(true);
  });

  it("--dry-run --tool all writes nothing", () => {
    bootstrapHuskyFixture(tmpDir);
    const code = cmdInstallHooks(["--tool", "all", "--workspace", tmpDir, "--dry-run"]);
    expect(code).toBe(0);

    // Summary rendered with dry-run badge.
    expect(stdout.join("\n")).toContain("dry run");

    // None of the per-tool artifacts were written.
    expect(fs.existsSync(path.join(tmpDir, ".claude/settings.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".husky/pre-commit"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".cursor/rules/architecture.mdc"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".aider/CONVENTIONS.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".clinerules"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".github/copilot-instructions.md"))).toBe(false);
  });

  it("rejects --tool all combined with --uninstall", () => {
    const code = cmdInstallHooks(["--tool", "all", "--workspace", tmpDir, "--uninstall"]);
    expect(code).toBe(2);
    expect(stderr.join("\n")).toMatch(/--tool all/);
  });
});
