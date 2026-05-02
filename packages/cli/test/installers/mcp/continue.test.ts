// ---------------------------------------------------------------------------
// Tests for `installers/mcp/continue.ts` — JSON-only adapter.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createContinueAdapter,
  getContinueConfigPath,
} from "../../../src/installers/mcp/continue.js";
import { hasChemagServer } from "../../../src/installers/mcp/_json-merge.js";

let tmpDir: string;
let homeDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-mcp-continue-"));
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-mcp-continue-home-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

describe("continue adapter", () => {
  it("project install writes <workspace>/.continue/mcpServers.json", () => {
    const adapter = createContinueAdapter({ homedir: () => homeDir });
    adapter.install({
      client: "continue",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    const cfgPath = path.join(tmpDir, ".continue", "mcpServers.json");
    expect(fs.existsSync(cfgPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    expect(hasChemagServer(parsed)).toBe(true);
  });

  it("user install writes <home>/.continue/mcpServers.json", () => {
    const adapter = createContinueAdapter({ homedir: () => homeDir });
    adapter.install({
      client: "continue",
      scope: "user",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    expect(fs.existsSync(path.join(homeDir, ".continue", "mcpServers.json"))).toBe(true);
  });

  it("getContinueConfigPath returns documented paths", () => {
    expect(getContinueConfigPath("project", tmpDir, () => homeDir)).toBe(
      path.join(tmpDir, ".continue", "mcpServers.json"),
    );
    expect(getContinueConfigPath("user", tmpDir, () => homeDir)).toBe(
      path.join(homeDir, ".continue", "mcpServers.json"),
    );
  });

  it("idempotent install", () => {
    const adapter = createContinueAdapter({ homedir: () => homeDir });
    const opts = {
      client: "continue" as const,
      scope: "project" as const,
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    };
    adapter.install(opts);
    const first = fs.readFileSync(path.join(tmpDir, ".continue", "mcpServers.json"), "utf-8");
    adapter.install(opts);
    const second = fs.readFileSync(path.join(tmpDir, ".continue", "mcpServers.json"), "utf-8");
    expect(second).toBe(first);
  });

  it("uninstall removes chemag entry", () => {
    const adapter = createContinueAdapter({ homedir: () => homeDir });
    const opts = {
      client: "continue" as const,
      scope: "project" as const,
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    };
    adapter.install(opts);
    adapter.uninstall(opts);
    const after = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".continue", "mcpServers.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(hasChemagServer(after)).toBe(false);
  });

  it("status reports registered=true after install", () => {
    const adapter = createContinueAdapter({ homedir: () => homeDir });
    adapter.install({
      client: "continue",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    const s = adapter.status("project", tmpDir);
    expect(s.registered).toBe(true);
    expect(s.client).toBe("continue");
  });
});
