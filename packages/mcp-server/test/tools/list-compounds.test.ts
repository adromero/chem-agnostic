// ---------------------------------------------------------------------------
// `list_compounds` tool tests.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import { listCompoundsTool } from "../../src/tools/list-compounds.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-lc-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("list_compounds", () => {
  it("returns all 3 compounds in the sample workspace", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await listCompoundsTool.handler({}, session);
    const names = out.compounds.map((c) => c.name).sort();
    expect(names).toEqual(["identity", "payments", "reporting"]);
  });

  it("filters by container type", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await listCompoundsTool.handler({ type: "compound" }, session);
    expect(out.compounds.length).toBe(3);
    for (const c of out.compounds) expect(c.type).toBe("compound");
  });

  it("populates roles_present and units_count", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await listCompoundsTool.handler({}, session);
    const payments = out.compounds.find((c) => c.name === "payments");
    expect(payments).toBeDefined();
    expect(payments!.units_count).toBe(4);
    expect(payments!.roles_present.sort()).toEqual(["adapter", "element", "interface", "reaction"]);
  });
});
