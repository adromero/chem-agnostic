// ---------------------------------------------------------------------------
// `validate_edit` warm-path latency gate (≤200ms).
//
// We treat the FIRST call as the cold path (workspace + plugin load,
// in-memory cache priming, etc.) and the next call as the warm path.
// The cold path varies a lot across machines, so we only gate the warm
// path. The cold timing is logged for visibility.
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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-perf-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("validate_edit — warm-path latency gate", () => {
  it("warm call completes in ≤200ms (cold path informational)", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const file = path.join(SAMPLE, "src/compounds/payments/adapters/StripeGateway.ts");

    // Cold call — load workspace, plugin, cache. Timing is logged but not gated.
    const cold0 = Date.now();
    await validateEditTool.handler({ file }, session);
    const coldMs = Date.now() - cold0;

    // Warm call — timing IS gated.
    const warm0 = Date.now();
    await validateEditTool.handler({ file }, session);
    const warmMs = Date.now() - warm0;

    // Surface both numbers if the gate trips.
    if (warmMs > 200) {
      // eslint-disable-next-line no-console
      console.error(`validate_edit warm=${warmMs}ms cold=${coldMs}ms`);
    }
    expect(warmMs).toBeLessThanOrEqual(200);
  });
});

describe("validate_edit — concurrent safety", () => {
  it("10 parallel calls do not corrupt the manifest cache", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const file = path.join(SAMPLE, "src/compounds/payments/adapters/StripeGateway.ts");

    const tasks = Array.from({ length: 10 }, () => validateEditTool.handler({ file }, session));
    const results = await Promise.all(tasks);
    for (const r of results) {
      expect(r.valid).toBe(true);
      expect(r.diagnostics).toEqual([]);
    }
  });
});
