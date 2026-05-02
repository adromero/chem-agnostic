// ---------------------------------------------------------------------------
// `architecture://violations` — covers test criterion #12: the resource and
// the `find_violations` tool MUST return identical Diagnostic arrays for the
// same workspace.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import { readViolations } from "../../src/resources/violations.js";
import { findViolationsTool } from "../../src/tools/find-violations.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-rsrc-v-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("architecture://violations", () => {
  it("returns mimeType=application/json with diagnostics array", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await readViolations(session);
    expect(out.uri).toBe("architecture://violations");
    expect(out.mimeType).toBe("application/json");
    const parsed = JSON.parse(out.text) as { diagnostics: unknown[]; total: number };
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
    expect(parsed.total).toBe(parsed.diagnostics.length);
  });

  it("returns the SAME diagnostics array as find_violations for the same workspace", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const resource = await readViolations(session);
    const fromResource = (JSON.parse(resource.text) as { diagnostics: unknown[] }).diagnostics;
    const tool = await findViolationsTool.handler({}, session);
    expect(fromResource).toEqual(tool.diagnostics);
  });
});
