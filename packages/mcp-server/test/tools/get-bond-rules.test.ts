// ---------------------------------------------------------------------------
// `get_bond_rules` tool tests.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import { getBondRulesTool } from "../../src/tools/get-bond-rules.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-gbr-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("get_bond_rules", () => {
  it("returns the role catalog, bonds map, compound_types, and cross-compound rule", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await getBondRulesTool.handler({}, session);
    expect(out.roles.map((r) => r.name).sort()).toEqual([
      "adapter",
      "buffer",
      "element",
      "interface",
      "molecule",
      "reaction",
    ]);
    expect(out.bonds.element).toEqual(["element"]);
    expect(out.cross_compound_rule).toBe("public_only");
  });

  it("vocabulary='standard' surfaces standard role labels (e.g. value-object)", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await getBondRulesTool.handler({ vocabulary: "standard" }, session);
    const element = out.roles.find((r) => r.name === "element");
    expect(element?.vocabulary_label).toBe("value-object");
  });

  it("vocabulary='chemistry' surfaces chemistry role labels (e.g. element)", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await getBondRulesTool.handler({ vocabulary: "chemistry" }, session);
    const element = out.roles.find((r) => r.name === "element");
    expect(element?.vocabulary_label).toBe("element");
  });
});
