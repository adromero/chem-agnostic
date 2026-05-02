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
  it("returns non-zero with CHEM-INSTALL-HOOKS-001 for `all` (WP-018 placeholder)", () => {
    // WP-013 promoted aider/cline/copilot from placeholders to implemented
    // tools. `all` remains the only known-but-not-yet-implemented value
    // until WP-018 wires the fan-out.
    const code = cmdInstallHooks(["--tool", "all", "--workspace", tmpDir]);
    expect(code).toBe(2);
    expect(stderr.join("\n")).toContain("CHEM-INSTALL-HOOKS-001");
    expect(stderr.join("\n")).toContain("all");
  });

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
