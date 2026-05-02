// ---------------------------------------------------------------------------
// Tool registry tests:
//   * snapshot of every tool's description (vocabulary-invariant — taken
//     under one configuration only),
//   * assertion that all 8 expected tools are exposed,
//   * an in-process MCP client connects via InMemoryTransport, calls
//     `tools/list`, and gets the 8 tools back. Regression-protects against
//     a `tools/list` placeholder being re-introduced — see WP-015 spec
//     test criterion #14.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ALL_TOOLS, createServer } from "../../src/index.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-registry-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("tool registry — coverage", () => {
  it("exposes exactly 8 tools", () => {
    expect(ALL_TOOLS).toHaveLength(8);
  });

  it("exposes the eight expected tool names", () => {
    const names = ALL_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      "explain_diagnostic",
      "find_violations",
      "get_bond_rules",
      "get_compound",
      "list_compounds",
      "scaffold_unit",
      "validate_edit",
      "where_should_this_go",
    ]);
  });

  it("every tool carries a non-empty plain-English description", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description).toBeTypeOf("string");
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});

describe("tool registry — description snapshot (vocabulary-invariant)", () => {
  it("matches the canonical description map", () => {
    const map: Record<string, string> = {};
    for (const tool of ALL_TOOLS) map[tool.name] = tool.description;
    expect(map).toMatchSnapshot();
  });
});

describe("tool registry — in-process tools/list", () => {
  it("returns all 8 tools to a real MCP client (regression for placeholder removal)", async () => {
    const handle = createServer({ workspaceUri: SAMPLE });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: "registry-test", version: "0.0.0" });
    try {
      await Promise.all([handle.connect(serverTransport), client.connect(clientTransport)]);

      const result = await client.listTools();
      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "explain_diagnostic",
        "find_violations",
        "get_bond_rules",
        "get_compound",
        "list_compounds",
        "scaffold_unit",
        "validate_edit",
        "where_should_this_go",
      ]);

      // Every tool has an inputSchema (even empty-shape ones produce a JSON
      // Schema with `type: "object"`).
      for (const t of result.tools) {
        expect(t.inputSchema).toBeDefined();
      }
    } finally {
      await client.close();
      await handle.dispose();
    }
  });
});
