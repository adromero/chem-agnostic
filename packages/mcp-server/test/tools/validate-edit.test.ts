// ---------------------------------------------------------------------------
// `validate_edit` tool tests.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import { validateEditTool } from "../../src/tools/validate-edit.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-vedit-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("validate_edit", () => {
  it("returns valid=true for a clean adapter file", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const file = path.join(SAMPLE, "src/compounds/payments/adapters/StripeGateway.ts");
    const out = await validateEditTool.handler({ file }, session);
    expect(out.valid).toBe(true);
    expect(out.diagnostics).toEqual([]);
  });

  it("flags an unplaceable file with CHEM-PLACEMENT-004", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const file = path.join(SAMPLE, "random.ts");
    const out = await validateEditTool.handler({ file }, session);
    expect(out.valid).toBe(false);
    expect(out.diagnostics.some((d) => d.code === "CHEM-PLACEMENT-004")).toBe(true);
  });

  it("uses --content override against a hypothetical file body", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const file = path.join(SAMPLE, "src/compounds/payments/elements/Money.ts");
    const out = await validateEditTool.handler(
      { file, new_content: "export type Money = { amount: number };\n" },
      session,
    );
    expect(out.valid).toBe(true);
  });
});
