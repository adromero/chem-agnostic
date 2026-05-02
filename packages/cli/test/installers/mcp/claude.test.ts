// ---------------------------------------------------------------------------
// Tests for `installers/mcp/claude.ts` — the WP-017 Claude MCP-client adapter.
//
// Covers:
//   - Path A success (CLI on PATH, exit 0) — exact spawn-arg pinning.
//   - Path A failure (CLI on PATH, non-zero exit) — CHEM-MCP-203 ERROR; NO
//     fallback to JSON-write.
//   - Path B (CLI not on PATH) — `.mcp.json` written with chemag-tagged entry.
//   - `--no-cli` forces Path B even when CLI is present (spawn never invoked).
//   - User scope writes to `~/.claude.json` (homedir injection).
//   - Idempotence — running twice produces byte-equal config.
//   - Uninstall via Path A spawn args (criterion 14).
//   - Status reads from JSON when CLI absent.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SpawnSyncReturns } from "node:child_process";
import {
  buildClaudeAddArgs,
  buildClaudeRemoveArgs,
  ClaudeCliFailedError,
  createClaudeAdapter,
  getClaudeConfigPath,
  type SpawnFn,
} from "../../../src/installers/mcp/claude.js";
import {
  CHEMAG_SERVER_NAME,
  hasChemagServer,
  serializeConfig,
} from "../../../src/installers/mcp/_json-merge.js";

let tmpDir: string;
let homeDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-mcp-claude-"));
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-mcp-home-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

function spawnOk(): SpawnFn {
  return vi.fn(() => ({
    pid: 1,
    output: [],
    stdout: Buffer.from(""),
    stderr: Buffer.from(""),
    status: 0,
    signal: null,
  })) as unknown as SpawnFn;
}

function spawnFail(code: number, stderrText: string): SpawnFn {
  return vi.fn(() => ({
    pid: 1,
    output: [],
    stdout: Buffer.from(""),
    stderr: Buffer.from(stderrText),
    status: code,
    signal: null,
  })) as unknown as SpawnFn;
}

function spawnNeverCalled(): SpawnFn {
  return vi.fn(() => {
    throw new Error("spawn must not be called on Path B");
  }) as unknown as SpawnFn;
}

// ---------------------------------------------------------------------------
// Path A — success
// ---------------------------------------------------------------------------

describe("claude adapter — Path A install (CLI on PATH, exit 0)", () => {
  it("spawns `claude mcp add ...` with the EXACT verified argv (criterion 14)", () => {
    const spawn = spawnOk();
    const adapter = createClaudeAdapter({
      spawn,
      which: () => true,
      homedir: () => homeDir,
    });
    const result = adapter.install({
      client: "claude",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });

    expect(result.path).toBe("cli");
    expect(result.changed).toBe(true);
    // Pin the argv array exactly. If upstream syntax changes, this fails loudly.
    expect(spawn).toHaveBeenCalledTimes(1);
    const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe("claude");
    expect(call[1]).toEqual([
      "mcp",
      "add",
      "--scope",
      "project",
      "chemag",
      "--",
      "chemag",
      "mcp",
      "--workspace",
      tmpDir,
    ]);
    // Pure helper assertion (insulated from any future spawn refactor).
    expect(
      buildClaudeAddArgs("project", tmpDir, {
        command: "chemag",
        args: ["mcp", "--workspace", tmpDir],
        _chemag: true,
      }),
    ).toEqual([
      "mcp",
      "add",
      "--scope",
      "project",
      "chemag",
      "--",
      "chemag",
      "mcp",
      "--workspace",
      tmpDir,
    ]);
  });

  it("does NOT write .mcp.json when Path A succeeds", () => {
    const adapter = createClaudeAdapter({
      spawn: spawnOk(),
      which: () => true,
      homedir: () => homeDir,
    });
    adapter.install({
      client: "claude",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Path A — failure (no fallback)
// ---------------------------------------------------------------------------

describe("claude adapter — Path A install failure (CLI exits non-zero)", () => {
  it("throws ClaudeCliFailedError with the captured stderr; does NOT write JSON", () => {
    const adapter = createClaudeAdapter({
      spawn: spawnFail(1, "permission denied"),
      which: () => true,
      homedir: () => homeDir,
    });
    expect(() =>
      adapter.install({
        client: "claude",
        scope: "project",
        workspaceDir: tmpDir,
        noCli: false,
        dryRun: false,
      }),
    ).toThrow(ClaudeCliFailedError);

    // Critical: NO silent fallback. The .mcp.json file MUST NOT exist.
    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(false);
  });

  it("captures stderr text on the error", () => {
    const adapter = createClaudeAdapter({
      spawn: spawnFail(2, "permission denied"),
      which: () => true,
      homedir: () => homeDir,
    });
    try {
      adapter.install({
        client: "claude",
        scope: "project",
        workspaceDir: tmpDir,
        noCli: false,
        dryRun: false,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ClaudeCliFailedError);
      const err = e as ClaudeCliFailedError;
      expect(err.cli).toBe("claude");
      expect(err.exitCode).toBe(2);
      expect(err.stderr).toContain("permission denied");
    }
  });
});

// ---------------------------------------------------------------------------
// Path B — CLI absent
// ---------------------------------------------------------------------------

describe("claude adapter — Path B install (CLI not on PATH)", () => {
  it("writes .mcp.json with mcpServers.chemag tagged _chemag: true", () => {
    const spawn = spawnNeverCalled();
    const adapter = createClaudeAdapter({
      spawn,
      which: () => false, // CLI absent
      homedir: () => homeDir,
    });
    const result = adapter.install({
      client: "claude",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });

    expect(result.path).toBe("json");
    expect(result.changed).toBe(true);

    const cfgPath = path.join(tmpDir, ".mcp.json");
    expect(fs.existsSync(cfgPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    expect(hasChemagServer(parsed)).toBe(true);
    const entry = (parsed.mcpServers as Record<string, unknown>)[CHEMAG_SERVER_NAME] as {
      command: string;
      args: string[];
      _chemag: boolean;
    };
    expect(entry.command).toBe("chemag");
    expect(entry.args).toEqual(["mcp", "--workspace", tmpDir]);
    expect(entry._chemag).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// --no-cli forces Path B even when CLI is present
// ---------------------------------------------------------------------------

describe("claude adapter — --no-cli forces Path B", () => {
  it("writes .mcp.json and does NOT spawn `claude` even though CLI is on PATH", () => {
    const spawn = spawnNeverCalled();
    const adapter = createClaudeAdapter({
      spawn,
      which: () => true, // CLI present
      homedir: () => homeDir,
    });
    const result = adapter.install({
      client: "claude",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: true, // force Path B
      dryRun: false,
    });
    expect(result.path).toBe("json");
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Idempotence
// ---------------------------------------------------------------------------

describe("claude adapter — idempotence", () => {
  it("Path B install twice produces byte-equal .mcp.json", () => {
    const adapter = createClaudeAdapter({
      spawn: spawnNeverCalled(),
      which: () => false,
      homedir: () => homeDir,
    });
    const opts = {
      client: "claude" as const,
      scope: "project" as const,
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    };
    adapter.install(opts);
    const first = fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8");
    adapter.install(opts);
    const second = fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8");
    expect(second).toBe(first);
  });

  it("re-running is a no-op (changed=false on second run)", () => {
    const adapter = createClaudeAdapter({
      spawn: spawnNeverCalled(),
      which: () => false,
      homedir: () => homeDir,
    });
    const opts = {
      client: "claude" as const,
      scope: "project" as const,
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    };
    adapter.install(opts);
    const r2 = adapter.install(opts);
    expect(r2.changed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// User scope routes to ~/.claude.json
// ---------------------------------------------------------------------------

describe("claude adapter — user scope", () => {
  it("user scope writes to <homedir>/.claude.json", () => {
    const adapter = createClaudeAdapter({
      spawn: spawnNeverCalled(),
      which: () => false,
      homedir: () => homeDir,
    });
    adapter.install({
      client: "claude",
      scope: "user",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    const userCfg = path.join(homeDir, ".claude.json");
    expect(fs.existsSync(userCfg)).toBe(true);
    const projectCfg = path.join(tmpDir, ".mcp.json");
    expect(fs.existsSync(projectCfg)).toBe(false);
  });

  it("getClaudeConfigPath('project') / ('user') resolve as documented", () => {
    expect(getClaudeConfigPath("project", tmpDir, () => homeDir)).toBe(
      path.join(tmpDir, ".mcp.json"),
    );
    expect(getClaudeConfigPath("user", tmpDir, () => homeDir)).toBe(
      path.join(homeDir, ".claude.json"),
    );
  });
});

// ---------------------------------------------------------------------------
// Path A uninstall — spawn-arg pinning (criterion 14 mirror)
// ---------------------------------------------------------------------------

describe("claude adapter — Path A uninstall", () => {
  it("spawns `claude mcp remove --scope project chemag` (exact argv)", () => {
    const spawn = spawnOk();
    const adapter = createClaudeAdapter({
      spawn,
      which: () => true,
      homedir: () => homeDir,
    });
    adapter.uninstall({
      client: "claude",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe("claude");
    expect(call[1]).toEqual(["mcp", "remove", "--scope", "project", "chemag"]);
    expect(buildClaudeRemoveArgs("project")).toEqual([
      "mcp",
      "remove",
      "--scope",
      "project",
      "chemag",
    ]);
  });

  it("treats `not found` stderr as no-op (changed=false), not an error", () => {
    const spawn = spawnFail(1, "Server 'chemag' not found");
    const adapter = createClaudeAdapter({
      spawn,
      which: () => true,
      homedir: () => homeDir,
    });
    const result = adapter.uninstall({
      client: "claude",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    expect(result.changed).toBe(false);
    expect(result.notes.join(" ")).toContain("not registered");
  });
});

// ---------------------------------------------------------------------------
// Path B uninstall preserves non-chemag entries
// ---------------------------------------------------------------------------

describe("claude adapter — Path B uninstall preserves non-chemag entries", () => {
  it("strips chemag entry; leaves user-managed entries intact", () => {
    // Pre-populate .mcp.json with a chemag entry + a user entry.
    const cfgPath = path.join(tmpDir, ".mcp.json");
    const initial = {
      mcpServers: {
        chemag: {
          command: "chemag",
          args: ["mcp", "--workspace", tmpDir],
          _chemag: true,
        },
        sentry: {
          command: "sentry-mcp",
          args: [],
        },
      },
    };
    fs.writeFileSync(cfgPath, serializeConfig(initial));

    const adapter = createClaudeAdapter({
      spawn: spawnNeverCalled(),
      which: () => false,
      homedir: () => homeDir,
    });
    adapter.uninstall({
      client: "claude",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    const after = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(after.mcpServers.chemag).toBeUndefined();
    expect(after.mcpServers.sentry).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// status — reads JSON when CLI absent
// ---------------------------------------------------------------------------

describe("claude adapter — status", () => {
  it("returns registered=false with a note when config does not exist yet", () => {
    const adapter = createClaudeAdapter({
      spawn: spawnNeverCalled(),
      which: () => false,
      homedir: () => homeDir,
    });
    const s = adapter.status("project", tmpDir);
    expect(s.registered).toBe(false);
    expect(s.config_path).toBe(path.join(tmpDir, ".mcp.json"));
    expect(s.notes.join(" ")).toContain("does not exist");
  });

  it("returns registered=true with the canonical server_command after install", () => {
    const adapter = createClaudeAdapter({
      spawn: spawnNeverCalled(),
      which: () => false,
      homedir: () => homeDir,
    });
    adapter.install({
      client: "claude",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    const s = adapter.status("project", tmpDir);
    expect(s.registered).toBe(true);
    expect(s.server_command).toBe(`chemag mcp --workspace ${tmpDir}`);
  });
});

// ---------------------------------------------------------------------------
// Dry-run never writes / never spawns
// ---------------------------------------------------------------------------

describe("claude adapter — dry-run", () => {
  it("Path A dry-run does NOT spawn `claude` and does NOT write .mcp.json", () => {
    const spawn = spawnNeverCalled();
    const adapter = createClaudeAdapter({
      spawn,
      which: () => true,
      homedir: () => homeDir,
    });
    adapter.install({
      client: "claude",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: true,
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(false);
  });

  it("Path B dry-run does NOT write .mcp.json", () => {
    const adapter = createClaudeAdapter({
      spawn: spawnNeverCalled(),
      which: () => false,
      homedir: () => homeDir,
    });
    adapter.install({
      client: "claude",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: true,
    });
    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(false);
  });
});
