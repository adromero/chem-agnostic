// ---------------------------------------------------------------------------
// `get_compound` tool tests.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import { getCompoundTool } from "../../src/tools/get-compound.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-gc-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("get_compound", () => {
  it("returns full details for an existing compound", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await getCompoundTool.handler({ name: "payments" }, session);
    expect(out.name).toBe("payments");
    expect(out.type).toBe("compound");
    expect(out.units?.length).toBe(4);
    expect(out.exports).toEqual({ interfaces: ["PaymentGateway"], reactions: ["chargeCustomer"] });
    expect(out.graph_subgraph_mermaid).toContain("graph LR");
    expect(out.graph_subgraph_mermaid).toContain("payments");
    expect(out.manifest_path).toContain("payments");
    expect(out.manifest_path).toContain("compound.yaml");
  });

  it("throws when the compound is not found", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    await expect(getCompoundTool.handler({ name: "ghost" }, session)).rejects.toThrow(/not found/i);
  });
});
