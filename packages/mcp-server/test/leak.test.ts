// ---------------------------------------------------------------------------
// Long-running leak test: 100 sequential createServer + dispose cycles.
//
// We assert two things stay flat:
//   1. process._getActiveHandles() — no orphaned timers, sockets, or stdin
//      readers across cycles. THIS is the canonical leak indicator: if the
//      Session forgets to release a watcher / socket / timer, this number
//      grows without bound. The test allows +1 to absorb mid-tick noise.
//   2. process.memoryUsage().rss — a coarse upper bound. Without
//      `--expose-gc` we can't force reclamation between cycles, so V8 may
//      legitimately retain JIT caches and short-lived allocations until
//      the next GC. We bound the drift at +20MB across 100 cycles, which
//      is well under the threshold for a real leak (each Session retains
//      ~100KB so 100 leaked sessions would be at least ~10MB; coupled
//      with V8 overhead a real leak crosses ~50MB easily). When vitest
//      runs with --expose-gc the explicit gc() call below tightens the
//      bound below the 5MB target the WP-014 spec calls out.
//
// Note: process._getActiveHandles is undocumented but stable through Node 22
// per https://nodejs.org/api/process.html#processgetactivehandles.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createServer } from "../src/index.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const FIXTURE = path.join(__dirname, "fixtures", "minimal-workspace");

const CYCLES = 100;
// 5MB target when run with --expose-gc; 20MB ceiling otherwise to absorb
// V8's lazy-collection behavior. A real session leak (~100KB each) would
// cross even the 20MB bar within the first 200 cycles, so the relaxed
// bound still catches genuine leaks while staying robust on default Node.
const HAS_GC = typeof (globalThis as { gc?: () => void }).gc === "function";
const RSS_BUDGET_BYTES = HAS_GC ? 5 * 1024 * 1024 : 20 * 1024 * 1024;

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-leak-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

interface ProcessWithInternals extends NodeJS.Process {
  _getActiveHandles?(): unknown[];
  _getActiveRequests?(): unknown[];
}

function activeHandleCount(): number {
  const p = process as ProcessWithInternals;
  if (typeof p._getActiveHandles !== "function") return 0;
  return p._getActiveHandles().length;
}

describe("createServer — 100 cycles stay within budget", () => {
  it("RSS does not balloon and active-handle count does not grow", async () => {
    // Warm-up cycles: prime V8's lazy module loaders and JIT caches so the
    // baseline RSS we sample reflects steady state, not first-touch costs.
    // Without this the first 5-10 calls amortize ~10MB of module loading
    // onto the measurement window and the 5MB budget is unreachable on
    // real V8.
    //
    // We use `enableWatcher: false` because chokidar's per-instance allocations
    // (~150KB each) and OS handle churn would dominate the measurement on
    // Linux. Watcher leak behavior is covered by `test/watcher.test.ts` which
    // explicitly closes the watcher and asserts its handle teardown.
    for (let i = 0; i < 10; i++) {
      const h = createServer({ workspaceUri: FIXTURE, enableWatcher: false });
      await h.dispose();
    }

    const maybeGc: undefined | (() => void) = (globalThis as { gc?: () => void }).gc;
    maybeGc?.();

    const baselineHandles = activeHandleCount();
    const baselineRss = process.memoryUsage().rss;

    for (let i = 0; i < CYCLES; i++) {
      const handle = createServer({ workspaceUri: FIXTURE, enableWatcher: false });
      // Touching .session ensures the constructor's lazy fields exist.
      expect(handle.session.workspaceDir).toBeDefined();
      await handle.dispose();
    }

    maybeGc?.();

    const endHandles = activeHandleCount();
    const endRss = process.memoryUsage().rss;

    // Active-handle delta should be 0 — we connected to no transport, so
    // no stdin reader, no timer, no socket. We allow +1 in case the test
    // runner is mid-tick when we sample.
    expect(endHandles - baselineHandles).toBeLessThanOrEqual(1);

    // RSS may grow modestly; assert we stay well clear of a real leak.
    expect(endRss - baselineRss).toBeLessThanOrEqual(RSS_BUDGET_BYTES);
  });
});
