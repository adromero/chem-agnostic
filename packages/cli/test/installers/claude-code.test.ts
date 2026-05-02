// ---------------------------------------------------------------------------
// Tests for the Claude Code installer (.claude/settings.json reader/writer).
// Covers all modes, idempotence, coexistence with pre-existing user hooks,
// uninstall, traceless _chemag removal, restore-from-bak.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildChemagHookSpecs,
  getClaudeSettingsPath,
  installClaudeCode,
  isAlreadyInstalled,
  uninstallClaudeCode,
} from "../../src/installers/claude-code.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-claude-installer-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("getClaudeSettingsPath", () => {
  it("project scope resolves under <workspace>/.claude/settings.json", () => {
    expect(getClaudeSettingsPath("project", "/abs/proj")).toBe("/abs/proj/.claude/settings.json");
  });

  it("user scope honors homeDirOverride for testing", () => {
    expect(getClaudeSettingsPath("user", "/abs/proj", "/fake-home")).toBe(
      "/fake-home/.claude/settings.json",
    );
  });
});

describe("buildChemagHookSpecs", () => {
  it("block mode includes both PreToolUse + PostToolUse with matcher Edit|Write", () => {
    const specs = buildChemagHookSpecs("block");
    expect(specs.length).toBe(2);
    const pre = specs.find((s) => s.event === "PreToolUse");
    const post = specs.find((s) => s.event === "PostToolUse");
    expect(pre?.matcher).toBe("Edit|Write");
    expect(post?.matcher).toBe("Edit|Write");
    // No --mode flag in block (block IS the default).
    expect(pre?.command).not.toContain("--mode");
    expect(pre?.command).toContain("check-edit");
    expect(post?.command).toContain("analyze");
  });

  it("warn mode adds --mode warn to the PreToolUse command", () => {
    const specs = buildChemagHookSpecs("warn");
    const pre = specs.find((s) => s.event === "PreToolUse");
    expect(pre?.command).toContain("--mode warn");
    // PostToolUse is identical regardless of mode.
    const post = specs.find((s) => s.event === "PostToolUse");
    expect(post?.command).not.toContain("--mode");
  });

  it("context-only mode omits PreToolUse entirely; only PostToolUse remains", () => {
    const specs = buildChemagHookSpecs("context-only");
    expect(specs.length).toBe(1);
    expect(specs[0].event).toBe("PostToolUse");
  });

  it("matcher is exactly Edit|Write (NOT Edit|Write|MultiEdit)", () => {
    for (const mode of ["block", "warn", "context-only"] as const) {
      for (const s of buildChemagHookSpecs(mode)) {
        expect(s.matcher).not.toContain("MultiEdit");
        expect(s.matcher).toBe("Edit|Write");
      }
    }
  });
});

describe("installClaudeCode — idempotence", () => {
  it("running install twice produces zero diffs in settings.json", () => {
    installClaudeCode({
      scope: "project",
      mode: "block",
      dryRun: false,
      workspaceRoot: tmpDir,
    });
    const first = fs.readFileSync(path.join(tmpDir, ".claude/settings.json"), "utf-8");
    installClaudeCode({
      scope: "project",
      mode: "block",
      dryRun: false,
      workspaceRoot: tmpDir,
    });
    const second = fs.readFileSync(path.join(tmpDir, ".claude/settings.json"), "utf-8");
    expect(second).toBe(first);
  });
});

describe("installClaudeCode — coexistence with non-chemag hooks", () => {
  it("preserves an existing PreToolUse Bash entry when chemag is installed", () => {
    const settingsPath = path.join(tmpDir, ".claude/settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [{ type: "command", command: "echo bash hook" }],
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    installClaudeCode({
      scope: "project",
      mode: "block",
      dryRun: false,
      workspaceRoot: tmpDir,
    });

    const merged = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(
      merged.hooks.PreToolUse.find((b: { matcher: string }) => b.matcher === "Bash"),
    ).toBeDefined();
    expect(
      merged.hooks.PreToolUse.find((b: { matcher: string }) => b.matcher === "Edit|Write"),
    ).toBeDefined();
  });
});

describe("installClaudeCode — modes (settings.json shape)", () => {
  it("block mode: PreToolUse command does NOT include --mode", () => {
    installClaudeCode({
      scope: "project",
      mode: "block",
      dryRun: false,
      workspaceRoot: tmpDir,
    });
    const text = fs.readFileSync(path.join(tmpDir, ".claude/settings.json"), "utf-8");
    expect(text).toContain('"PreToolUse"');
    expect(text).toContain('"PostToolUse"');
    expect(text).toContain("Edit|Write");
    expect(text).not.toContain("--mode warn");
  });

  it("warn mode: PreToolUse command includes --mode warn", () => {
    installClaudeCode({
      scope: "project",
      mode: "warn",
      dryRun: false,
      workspaceRoot: tmpDir,
    });
    const text = fs.readFileSync(path.join(tmpDir, ".claude/settings.json"), "utf-8");
    expect(text).toContain("--mode warn");
  });

  it("context-only mode: PreToolUse absent; only PostToolUse present", () => {
    installClaudeCode({
      scope: "project",
      mode: "context-only",
      dryRun: false,
      workspaceRoot: tmpDir,
    });
    const merged = JSON.parse(fs.readFileSync(path.join(tmpDir, ".claude/settings.json"), "utf-8"));
    expect(merged.hooks.PreToolUse).toBeUndefined();
    expect(merged.hooks.PostToolUse).toBeDefined();
  });
});

describe("uninstallClaudeCode — removes only chemag entries", () => {
  it("preserves non-chemag entries; drops every _chemag-tagged entry", () => {
    const settingsPath = path.join(tmpDir, ".claude/settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [{ type: "command", command: "/usr/local/bin/safety.sh" }],
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    installClaudeCode({
      scope: "project",
      mode: "block",
      dryRun: false,
      workspaceRoot: tmpDir,
    });
    expect(isAlreadyInstalled(settingsPath)).toBe(true);

    uninstallClaudeCode({
      scope: "project",
      restore: false,
      dryRun: false,
      workspaceRoot: tmpDir,
    });
    expect(isAlreadyInstalled(settingsPath)).toBe(false);

    const final = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    // Bash matcher still present.
    expect(
      final.hooks.PreToolUse.find((b: { matcher: string }) => b.matcher === "Bash"),
    ).toBeDefined();
    // Edit|Write matcher block is gone (was chemag-only).
    expect(
      final.hooks.PreToolUse.find((b: { matcher: string }) => b.matcher === "Edit|Write"),
    ).toBeUndefined();
  });
});

describe("install/uninstall traceless round-trip", () => {
  it("starting from settings.json with no _chemag, install→uninstall produces byte-identical output", () => {
    const settingsPath = path.join(tmpDir, ".claude/settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const original = `${JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "echo whoami" }],
            },
          ],
        },
      },
      null,
      2,
    )}\n`;
    fs.writeFileSync(settingsPath, original);

    installClaudeCode({
      scope: "project",
      mode: "block",
      dryRun: false,
      workspaceRoot: tmpDir,
    });
    uninstallClaudeCode({
      scope: "project",
      restore: false,
      dryRun: false,
      workspaceRoot: tmpDir,
    });

    const after = fs.readFileSync(settingsPath, "utf-8");
    expect(after).toBe(original);
  });
});

describe("backup + restore", () => {
  it("install creates <settings>.bak; --uninstall --restore returns it", () => {
    const settingsPath = path.join(tmpDir, ".claude/settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const before = '{"foo":"bar"}\n';
    fs.writeFileSync(settingsPath, before);

    installClaudeCode({
      scope: "project",
      mode: "block",
      dryRun: false,
      workspaceRoot: tmpDir,
    });
    expect(fs.existsSync(`${settingsPath}.bak`)).toBe(true);
    expect(fs.readFileSync(`${settingsPath}.bak`, "utf-8")).toBe(before);

    // Modify post-install and assert restore returns the original.
    fs.writeFileSync(settingsPath, '{"corrupted":true}\n');
    uninstallClaudeCode({
      scope: "project",
      restore: true,
      dryRun: false,
      workspaceRoot: tmpDir,
    });
    expect(fs.readFileSync(settingsPath, "utf-8")).toBe(before);
  });
});

describe("dry-run", () => {
  it("--dry-run writes nothing to disk", () => {
    const settingsPath = path.join(tmpDir, ".claude/settings.json");
    installClaudeCode({
      scope: "project",
      mode: "block",
      dryRun: true,
      workspaceRoot: tmpDir,
    });
    expect(fs.existsSync(settingsPath)).toBe(false);
    expect(fs.existsSync(`${settingsPath}.bak`)).toBe(false);
  });
});

describe("scope routing — user via homeDirOverride", () => {
  it("--scope user writes to <home>/.claude/settings.json", () => {
    const fakeHome = path.join(tmpDir, "home");
    fs.mkdirSync(fakeHome, { recursive: true });

    installClaudeCode({
      scope: "user",
      mode: "block",
      dryRun: false,
      workspaceRoot: tmpDir,
      homeDirOverride: fakeHome,
    });

    expect(fs.existsSync(path.join(fakeHome, ".claude/settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".claude/settings.json"))).toBe(false);
  });
});
