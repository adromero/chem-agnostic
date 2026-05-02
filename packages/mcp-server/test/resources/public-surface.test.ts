// ---------------------------------------------------------------------------
// `architecture://compound/{name}/public-surface` — lists exported symbols
// from a compound's manifest exports map. Unknown compound → CHEM-MCP-302.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import { ResourceCompoundNotFoundError } from "../../src/resources/compound.js";
import { publicSurfaceUri, readPublicSurface } from "../../src/resources/public-surface.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-rsrc-ps-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("architecture://compound/{name}/public-surface", () => {
  it("lists the exports declared in the manifest", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await readPublicSurface(session, "reporting");
    expect(out.uri).toBe(publicSurfaceUri("reporting"));
    expect(out.mimeType).toBe("text/plain");
    // The reporting compound exports interfaces:[ReportRepository] in the fixture.
    expect(out.text).toContain("interfaces: ReportRepository");
  });

  it("throws CHEM-MCP-302 for an unknown compound", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    let captured: unknown = null;
    try {
      await readPublicSurface(session, "ghost");
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(ResourceCompoundNotFoundError);
  });
});
