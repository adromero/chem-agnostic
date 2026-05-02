// ---------------------------------------------------------------------------
// `architecture://compound/{name}` — covers happy path and the
// CHEM-MCP-302 (resource_compound_not_found) error path.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import {
  ResourceCompoundNotFoundError,
  compoundUri,
  readCompound,
} from "../../src/resources/compound.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-rsrc-c-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("architecture://compound/{name}", () => {
  it("returns the compound manifest as JSON for a known compound", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await readCompound(session, "payments");
    expect(out.uri).toBe(compoundUri("payments"));
    expect(out.mimeType).toBe("application/json");
    const parsed = JSON.parse(out.text) as { compound: string };
    expect(parsed.compound).toBe("payments");
  });

  it("throws CHEM-MCP-302 for an unknown compound", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    let captured: unknown = null;
    try {
      await readCompound(session, "nonexistent");
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(ResourceCompoundNotFoundError);
    expect((captured as ResourceCompoundNotFoundError).code).toBe("CHEM-MCP-302");
    expect((captured as ResourceCompoundNotFoundError).compoundName).toBe("nonexistent");
  });
});
