// ---------------------------------------------------------------------------
// Tests for `installers/mcp/cursor.ts` — JSON-only adapter.
// Cursor has no public MCP CLI, so every install/uninstall is Path B.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createCursorAdapter, getCursorConfigPath } from "../../../src/installers/mcp/cursor.js";
import {
  CHEMAG_SERVER_NAME,
  hasChemagServer,
  serializeConfig,
} from "../../../src/installers/mcp/_json-merge.js";

let tmpDir: string;
let homeDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-mcp-cursor-"));
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-mcp-cursor-home-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

describe("cursor adapter — install", () => {
  it("writes <workspace>/.cursor/mcp.json with chemag-tagged entry", () => {
    const adapter = createCursorAdapter({ homedir: () => homeDir });
    adapter.install({
      client: "cursor",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    const cfgPath = path.join(tmpDir, ".cursor", "mcp.json");
    expect(fs.existsSync(cfgPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    expect(hasChemagServer(parsed)).toBe(true);
  });

  it("user scope writes to <home>/.cursor/mcp.json", () => {
    const adapter = createCursorAdapter({ homedir: () => homeDir });
    adapter.install({
      client: "cursor",
      scope: "user",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    expect(fs.existsSync(path.join(homeDir, ".cursor", "mcp.json"))).toBe(true);
  });

  it("getCursorConfigPath returns the documented paths", () => {
    expect(getCursorConfigPath("project", tmpDir, () => homeDir)).toBe(
      path.join(tmpDir, ".cursor", "mcp.json"),
    );
    expect(getCursorConfigPath("user", tmpDir, () => homeDir)).toBe(
      path.join(homeDir, ".cursor", "mcp.json"),
    );
  });

  it("idempotent — re-running produces byte-equal output", () => {
    const adapter = createCursorAdapter({ homedir: () => homeDir });
    const opts = {
      client: "cursor" as const,
      scope: "project" as const,
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    };
    adapter.install(opts);
    const first = fs.readFileSync(path.join(tmpDir, ".cursor", "mcp.json"), "utf-8");
    adapter.install(opts);
    const second = fs.readFileSync(path.join(tmpDir, ".cursor", "mcp.json"), "utf-8");
    expect(second).toBe(first);
  });

  it("preserves existing non-chemag entries", () => {
    const cfgPath = path.join(tmpDir, ".cursor", "mcp.json");
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    const initial = {
      mcpServers: {
        manual: { command: "user-tool", args: [] },
      },
    };
    fs.writeFileSync(cfgPath, serializeConfig(initial));

    const adapter = createCursorAdapter({ homedir: () => homeDir });
    adapter.install({
      client: "cursor",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    const after = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(after.mcpServers.manual).toBeDefined();
    expect(after.mcpServers[CHEMAG_SERVER_NAME]).toBeDefined();
  });
});

describe("cursor adapter — uninstall", () => {
  it("removes chemag entry; preserves other servers", () => {
    const adapter = createCursorAdapter({ homedir: () => homeDir });
    adapter.install({
      client: "cursor",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    const cfgPath = path.join(tmpDir, ".cursor", "mcp.json");
    // Add a non-chemag entry.
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as {
      mcpServers: Record<string, unknown>;
    };
    cfg.mcpServers.user = { command: "x", args: [] };
    fs.writeFileSync(cfgPath, serializeConfig(cfg));

    adapter.uninstall({
      client: "cursor",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    const after = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(after.mcpServers.chemag).toBeUndefined();
    expect(after.mcpServers.user).toBeDefined();
  });

  it("no-op when config file does not exist", () => {
    const adapter = createCursorAdapter({ homedir: () => homeDir });
    const result = adapter.uninstall({
      client: "cursor",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    expect(result.changed).toBe(false);
  });
});

describe("cursor adapter — status", () => {
  it("returns registered=false when config absent", () => {
    const adapter = createCursorAdapter({ homedir: () => homeDir });
    const s = adapter.status("project", tmpDir);
    expect(s.registered).toBe(false);
    expect(s.config_path).toBe(path.join(tmpDir, ".cursor", "mcp.json"));
  });

  it("returns registered=true after install", () => {
    const adapter = createCursorAdapter({ homedir: () => homeDir });
    adapter.install({
      client: "cursor",
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
