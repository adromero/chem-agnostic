// ---------------------------------------------------------------------------
// `architecture://workspace` resource — unit test against a Session backed
// by the sample-workspace fixture. Asserts:
//   * mimeType is application/json
//   * body is valid JSON and contains workspace.workspace
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import { readWorkspace } from "../../src/resources/workspace.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-rsrc-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("architecture://workspace", () => {
  it("returns the parsed workspace.yaml as JSON", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await readWorkspace(session);
    expect(out.uri).toBe("architecture://workspace");
    expect(out.mimeType).toBe("application/json");
    const parsed = JSON.parse(out.text) as { workspace: string };
    expect(parsed.workspace).toBe("sample");
  });
});
