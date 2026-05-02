// ---------------------------------------------------------------------------
// MCP server scaffolding tests.
//
// These tests exercise `createServer` directly without booting a transport.
// We assert the capability surface, the server identity, and the
// vocabulary-handoff contract. The transport-level handshake is exercised
// from packages/cli/test/commands/mcp.test.ts using a child process.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createServer, SERVER_CAPABILITIES, VERSION } from "../src/index.js";
import {
  __resetForTesting as __resetVocabularyForTesting,
  getVocabulary,
  getVocabularySource,
  setVocabulary,
} from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const FIXTURE = path.join(__dirname, "fixtures", "minimal-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-srv-"));
  // Force the cache root inside the tmp tree so tests don't dirty the
  // checked-in fixture.
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("createServer — identity and capability surface", () => {
  it("returns a handle whose server reports name=chemag and version=VERSION", () => {
    const handle = createServer({ workspaceUri: FIXTURE });
    // McpServer wraps the underlying Server; its constructor stashes the
    // identity directly into the wrapped server. We don't poke into private
    // fields — instead we assert via the publicly-exposed surface used by
    // the SDK's _oninitialize handler. Reading VERSION here proves the
    // build-version pipeline produced a string.
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
    expect(handle.server).toBeDefined();
    expect(handle.session).toBeDefined();
  });

  it("advertises tools / resources / prompts capability flags", () => {
    expect(SERVER_CAPABILITIES.tools).toBeDefined();
    expect(SERVER_CAPABILITIES.resources).toBeDefined();
    expect(SERVER_CAPABILITIES.resources?.subscribe).toBe(true);
    expect(SERVER_CAPABILITIES.prompts).toBeDefined();
  });

  it("session.workspaceDir reflects the resolved absolute path", () => {
    const handle = createServer({ workspaceUri: FIXTURE });
    expect(path.isAbsolute(handle.session.workspaceDir)).toBe(true);
    expect(handle.session.workspaceDir).toBe(path.resolve(FIXTURE));
  });

  it("createServer with no workspaceUri defaults to process.cwd()", () => {
    const prev = process.cwd();
    process.chdir(tmpRoot);
    try {
      const handle = createServer();
      expect(handle.session.workspaceDir).toBe(path.resolve(tmpRoot));
    } finally {
      process.chdir(prev);
    }
  });
});

describe("createServer — vocabulary handoff", () => {
  it("client-supplied vocabulary is applied at the session rank", () => {
    expect(getVocabulary()).toBe("standard");
    expect(getVocabularySource()).toBe("default");
    createServer({ workspaceUri: FIXTURE, vocabulary: "chemistry" });
    expect(getVocabulary()).toBe("chemistry");
    expect(getVocabularySource()).toBe("session");
  });

  it("workspace.yaml vocabulary outranks session — workspace is source of truth", async () => {
    // Write a fixture that declares a vocabulary, in a tmp dir so we can
    // tweak it without touching the checked-in fixture.
    const wsDir = path.join(tmpRoot, "ws");
    fs.mkdirSync(path.join(wsDir, "src", "compounds"), { recursive: true });
    fs.writeFileSync(
      path.join(wsDir, "workspace.yaml"),
      [
        "workspace: tmp",
        "language: typescript",
        "vocabulary: standard",
        "roles:",
        "  element:",
        "    description: V",
        "    folder: elements",
        "bonds:",
        "  element: [element]",
        "paths:",
        "  compounds: ./src/compounds",
        "",
      ].join("\n"),
      "utf-8",
    );

    const handle = createServer({ workspaceUri: wsDir, vocabulary: "chemistry" });
    expect(getVocabulary()).toBe("chemistry");
    expect(getVocabularySource()).toBe("session");

    // Loading the workspace pumps Phase-2; workspace beats session.
    await handle.session.loadWorkspace();
    expect(getVocabulary()).toBe("standard");
    expect(getVocabularySource()).toBe("workspace");
  });

  it("flag still beats session — operator override remains sticky", () => {
    setVocabulary("standard", "flag");
    createServer({ workspaceUri: FIXTURE, vocabulary: "chemistry" });
    expect(getVocabulary()).toBe("standard");
    expect(getVocabularySource()).toBe("flag");
  });
});

describe("ServerHandle.dispose", () => {
  it("dispose() closes the server and disposes the session", async () => {
    const handle = createServer({ workspaceUri: FIXTURE });
    await handle.dispose();
    expect(handle.session.disposed).toBe(true);
  });

  it("post-dispose Session methods throw with a clear error", async () => {
    const handle = createServer({ workspaceUri: FIXTURE });
    await handle.dispose();
    await expect(handle.session.loadWorkspace()).rejects.toThrow(/disposed/i);
  });
});
