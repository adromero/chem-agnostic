// ---------------------------------------------------------------------------
// `architecture://graph.mermaid` — returns text/markdown wrapping a Mermaid
// graph LR diagram for the workspace.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import { readGraph } from "../../src/resources/graph.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-rsrc-g-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("architecture://graph.mermaid", () => {
  it("returns a fenced mermaid markdown body", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await readGraph(session);
    expect(out.uri).toBe("architecture://graph.mermaid");
    expect(out.mimeType).toBe("text/markdown");
    expect(out.text.startsWith("```mermaid\n")).toBe(true);
    expect(out.text).toContain("graph LR");
    expect(out.text.trim().endsWith("```")).toBe(true);
  });
});
