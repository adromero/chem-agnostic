// ---------------------------------------------------------------------------
// Tests for `installers/mcp/cline.ts` — JSON-only adapter.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createClineAdapter, getClineConfigPath } from "../../../src/installers/mcp/cline.js";
import { hasChemagServer } from "../../../src/installers/mcp/_json-merge.js";

let tmpDir: string;
let homeDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-mcp-cline-"));
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-mcp-cline-home-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

describe("cline adapter", () => {
  it("project install writes <workspace>/.cline/mcp.json", () => {
    const adapter = createClineAdapter({ homedir: () => homeDir });
    adapter.install({
      client: "cline",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    expect(fs.existsSync(path.join(tmpDir, ".cline", "mcp.json"))).toBe(true);
    const parsed = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".cline", "mcp.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(hasChemagServer(parsed)).toBe(true);
  });

  it("user install writes <home>/.cline/mcp.json", () => {
    const adapter = createClineAdapter({ homedir: () => homeDir });
    adapter.install({
      client: "cline",
      scope: "user",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    expect(fs.existsSync(path.join(homeDir, ".cline", "mcp.json"))).toBe(true);
  });

  it("getClineConfigPath returns documented paths", () => {
    expect(getClineConfigPath("project", tmpDir, () => homeDir)).toBe(
      path.join(tmpDir, ".cline", "mcp.json"),
    );
    expect(getClineConfigPath("user", tmpDir, () => homeDir)).toBe(
      path.join(homeDir, ".cline", "mcp.json"),
    );
  });

  it("idempotent install", () => {
    const adapter = createClineAdapter({ homedir: () => homeDir });
    const opts = {
      client: "cline" as const,
      scope: "project" as const,
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    };
    adapter.install(opts);
    const first = fs.readFileSync(path.join(tmpDir, ".cline", "mcp.json"), "utf-8");
    adapter.install(opts);
    const second = fs.readFileSync(path.join(tmpDir, ".cline", "mcp.json"), "utf-8");
    expect(second).toBe(first);
  });

  it("uninstall removes chemag entry", () => {
    const adapter = createClineAdapter({ homedir: () => homeDir });
    const opts = {
      client: "cline" as const,
      scope: "project" as const,
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    };
    adapter.install(opts);
    adapter.uninstall(opts);
    const after = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".cline", "mcp.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(hasChemagServer(after)).toBe(false);
  });

  it("status reports registered=true after install", () => {
    const adapter = createClineAdapter({ homedir: () => homeDir });
    adapter.install({
      client: "cline",
      scope: "project",
      workspaceDir: tmpDir,
      noCli: false,
      dryRun: false,
    });
    const s = adapter.status("project", tmpDir);
    expect(s.registered).toBe(true);
    expect(s.client).toBe("cline");
  });
});
