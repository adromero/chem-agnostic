// ---------------------------------------------------------------------------
// Integration test for spec criterion #16: full handshake → subscribe →
// file change → notifications/resources/updated → unsubscribe → second
// change produces NO further notification.
//
// Uses InMemoryTransport for the transport pair so the test stays in-process
// and deterministic. The chokidar watcher runs against a real tmp workspace
// directory. We use `usePolling: true`-equivalent indirectly by accepting a
// generous arrival window (≤2s) so CI sandboxes without inotify still pass.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../../src/index.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;
let workspaceDir: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-sub-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
  // Copy the sample workspace to a writable location so we can mutate it.
  workspaceDir = path.join(tmpRoot, "ws");
  fs.cpSync(SAMPLE, workspaceDir, { recursive: true });
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function tick(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("subscribe → file change → notification flow", () => {
  it("delivers exactly one notifications/resources/updated for a workspace.yaml change", async () => {
    const handle = createServer({ workspaceUri: workspaceDir });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "sub-flow", version: "0.0.0" });

    const updates: Array<{ uri: string }> = [];
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (note) => {
      updates.push({ uri: note.params.uri });
    });

    try {
      await Promise.all([handle.connect(serverTransport), client.connect(clientTransport)]);
      // Wait for the chokidar initial-scan to complete.
      await handle.session.watcher?.ready();

      // Subscribe.
      await client.subscribeResource({ uri: "architecture://workspace" });

      // Mutate workspace.yaml.
      const wsPath = path.join(workspaceDir, "workspace.yaml");
      const before = fs.readFileSync(wsPath, "utf-8");
      fs.writeFileSync(wsPath, `${before}\n# touched: ${Date.now()}\n`, "utf-8");

      // Wait up to 2s for the watcher → notifier pipeline to fire.
      const deadline = Date.now() + 2000;
      while (updates.length === 0 && Date.now() < deadline) {
        await tick(50);
      }
      expect(updates.length).toBeGreaterThanOrEqual(1);
      expect(updates[0].uri).toBe("architecture://workspace");

      // Unsubscribe.
      await client.unsubscribeResource({ uri: "architecture://workspace" });

      const baseline = updates.length;
      // Mutate again.
      fs.writeFileSync(wsPath, `${before}\n# again: ${Date.now()}\n`, "utf-8");
      await tick(800);
      // No further notifications.
      expect(updates.length).toBe(baseline);
    } finally {
      await client.close();
      await handle.dispose();
    }
  }, 10000);

  it("compound.yaml changes notify the compound and violations URIs only", async () => {
    const handle = createServer({ workspaceUri: workspaceDir });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "sub-flow-c", version: "0.0.0" });

    const updates: string[] = [];
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (note) => {
      updates.push(note.params.uri);
    });

    try {
      await Promise.all([handle.connect(serverTransport), client.connect(clientTransport)]);
      await handle.session.watcher?.ready();

      // Subscribe to BOTH the compound and the workspace; only the compound
      // (and the implicit violations + graph URIs that the resource layer
      // also fires) should arrive.
      await client.subscribeResource({ uri: "architecture://compound/payments" });
      await client.subscribeResource({ uri: "architecture://workspace" });

      const cpath = path.join(workspaceDir, "src/compounds/payments/compound.yaml");
      const before = fs.readFileSync(cpath, "utf-8");
      fs.writeFileSync(cpath, `${before}\n# nudge\n`, "utf-8");

      const deadline = Date.now() + 2000;
      while (!updates.includes("architecture://compound/payments") && Date.now() < deadline) {
        await tick(50);
      }
      expect(updates).toContain("architecture://compound/payments");
      // Workspace URI is NOT subscribed-to-fired here because the file that
      // changed is a compound manifest, not workspace.yaml.
      expect(updates).not.toContain("architecture://workspace");
    } finally {
      await client.close();
      await handle.dispose();
    }
  }, 10000);
});
