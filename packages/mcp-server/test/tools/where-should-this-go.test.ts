// ---------------------------------------------------------------------------
// `where_should_this_go` tool tests.
//
// Covers:
//   * "add a Stripe payment flow" returns ≥1 suggestion with confidence > 0.1
//     and a non-empty rationale (spec test criterion #3),
//   * a path-shaped description short-circuits to resolveFilePlacement.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import { whereShouldThisGoTool } from "../../src/tools/where-should-this-go.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-wstg-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("where_should_this_go — TF-IDF over compound descriptions", () => {
  it("'add a Stripe payment flow' returns ≥1 suggestion with confidence > 0.1 and a non-empty rationale", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await whereShouldThisGoTool.handler(
      { description: "add a Stripe payment flow" },
      session,
    );
    expect(out.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(out.suggestions[0].confidence).toBeGreaterThan(0.1);
    expect(out.suggestions[0].rationale).toBeTypeOf("string");
    expect(out.suggestions[0].rationale.length).toBeGreaterThan(0);
    // The strongest match should be in the payments compound.
    expect(out.suggestions[0].compound).toBe("payments");
  });

  it("intent_hint=infrastructure boosts adapter-role suggestions", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await whereShouldThisGoTool.handler(
      { description: "stripe charge integration", intent_hint: "infrastructure" },
      session,
    );
    expect(out.suggestions.length).toBeGreaterThanOrEqual(1);
    // With the boost, an adapter result should make top-2.
    const top2 = out.suggestions.slice(0, 2);
    expect(top2.some((s) => s.role === "adapter")).toBe(true);
  });
});

describe("where_should_this_go — path short-circuit", () => {
  it("resolves a path-shaped description via resolveFilePlacement", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await whereShouldThisGoTool.handler(
      { description: "src/compounds/payments/elements/Money.ts" },
      session,
    );
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].compound).toBe("payments");
    expect(out.suggestions[0].role).toBe("element");
    expect(out.suggestions[0].confidence).toBe(1);
  });
});
