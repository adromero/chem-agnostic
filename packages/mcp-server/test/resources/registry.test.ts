// ---------------------------------------------------------------------------
// Resource registry tests:
//   * resources/list returns the static URIs (workspace, violations, graph,
//     docs/* via the docs template)
//   * resources/templates/list returns the parameterized templates
//   * the SubscribeRequestSchema handler is wired (regression for spec
//     criterion #16: without the explicit setRequestHandler call, this would
//     produce MethodNotFound)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/index.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-rreg-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("resource registry — coverage", () => {
  it("resources/list surfaces workspace, violations, graph", async () => {
    const handle = createServer({ workspaceUri: SAMPLE, enableWatcher: false });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "rreg", version: "0.0.0" });
    try {
      await Promise.all([handle.connect(serverTransport), client.connect(clientTransport)]);
      const result = await client.listResources();
      const uris = result.resources.map((r) => r.uri).sort();
      expect(uris).toContain("architecture://workspace");
      expect(uris).toContain("architecture://violations");
      expect(uris).toContain("architecture://graph.mermaid");
    } finally {
      await client.close();
      await handle.dispose();
    }
  });

  it("resources/templates/list surfaces compound + public-surface + docs templates", async () => {
    const handle = createServer({ workspaceUri: SAMPLE, enableWatcher: false });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "rreg", version: "0.0.0" });
    try {
      await Promise.all([handle.connect(serverTransport), client.connect(clientTransport)]);
      const result = await client.listResourceTemplates();
      const patterns = result.resourceTemplates.map((t) => t.uriTemplate).sort();
      expect(patterns).toContain("architecture://compound/{name}");
      expect(patterns).toContain("architecture://compound/{name}/public-surface");
      expect(patterns).toContain("architecture://docs/{section}");
    } finally {
      await client.close();
      await handle.dispose();
    }
  });

  it("subscribing to a known URI does NOT raise MethodNotFound", async () => {
    // Regression for criterion #16: WP-014 scaffolded only the capability
    // flag; without WP-016's explicit setRequestHandler call this would
    // throw "Method not found" because McpServer doesn't auto-install
    // resources/subscribe.
    const handle = createServer({ workspaceUri: SAMPLE, enableWatcher: false });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "rreg", version: "0.0.0" });
    try {
      await Promise.all([handle.connect(serverTransport), client.connect(clientTransport)]);
      // The SDK Client wraps subscribe / unsubscribe.
      await expect(
        client.subscribeResource({ uri: "architecture://workspace" }),
      ).resolves.toBeDefined();
      await expect(
        client.unsubscribeResource({ uri: "architecture://workspace" }),
      ).resolves.toBeDefined();
    } finally {
      await client.close();
      await handle.dispose();
    }
  });

  it("reads each static resource and gets a non-empty body", async () => {
    const handle = createServer({ workspaceUri: SAMPLE, enableWatcher: false });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "rreg", version: "0.0.0" });
    try {
      await Promise.all([handle.connect(serverTransport), client.connect(clientTransport)]);

      for (const uri of [
        "architecture://workspace",
        "architecture://violations",
        "architecture://graph.mermaid",
      ]) {
        const r = await client.readResource({ uri });
        expect(r.contents.length).toBeGreaterThan(0);
        const first = r.contents[0] as { text?: string };
        expect(first.text?.length ?? 0).toBeGreaterThan(0);
      }
    } finally {
      await client.close();
      await handle.dispose();
    }
  });
});
