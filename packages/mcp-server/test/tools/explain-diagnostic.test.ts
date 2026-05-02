// ---------------------------------------------------------------------------
// `explain_diagnostic` tool tests.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import { explainDiagnosticTool } from "../../src/tools/explain-diagnostic.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-ed-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("explain_diagnostic", () => {
  it("returns description, level, doc_url, and an empty examples array for CHEM-BOND-001", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await explainDiagnosticTool.handler({ code: "CHEM-BOND-001" }, session);
    expect(out.code).toBe("CHEM-BOND-001");
    expect(out.level).toBe("error");
    expect(out.description).toBeTypeOf("string");
    expect(out.description.length).toBeGreaterThan(0);
    expect(out.doc_url).toContain("chemag.dev");
    expect(out.doc_url).toContain("chem-bond-001");
    expect(Array.isArray(out.examples)).toBe(true);
    expect(out.examples).toEqual([]);
  });

  it("throws for an unknown code", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    await expect(
      explainDiagnosticTool.handler({ code: "CHEM-BOGUS-999" }, session),
    ).rejects.toThrow(/unknown/i);
  });
});
