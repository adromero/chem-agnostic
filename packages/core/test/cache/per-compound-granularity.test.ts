// Per-compound cache granularity: editing one compound's compound.yaml must
// re-parse only that compound on the next run; siblings stay warm.
//
// We instrument the loader by passing a wrapped `loadCompound` hook that
// counts invocations, then run discoverCompounds twice with one compound
// mutated between runs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  discoverCompounds,
  loadCompound as defaultLoadCompound,
  loadWorkspace,
} from "@chemag/core/loader";
import type { LoadedCompound } from "@chemag/core/types";
import { contentHash } from "../../src/cache/content-hash.js";
import { createManifestCache } from "../../src/cache/manifest-cache.js";
import { __resetCacheStateForTesting } from "../../src/cache/cache-state.js";

let workspaceDir: string;

beforeEach(() => {
  __resetCacheStateForTesting();
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-pcg-"));
});

afterEach(() => {
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(workspaceDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function setupWorkspace(compounds: string[]): string {
  const wsYaml = `workspace: gran
language: typescript
roles:
  element: { description: V, folder: elements }
bonds:
  element: [element]
paths:
  compounds: ./src/compounds
`;
  const wsPath = path.join(workspaceDir, "workspace.yaml");
  fs.writeFileSync(wsPath, wsYaml, "utf-8");
  for (const name of compounds) {
    const dir = path.join(workspaceDir, "src", "compounds", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "compound.yaml"), `compound: ${name}\n`, "utf-8");
  }
  return wsPath;
}

/**
 * Build a cache-aware loadCompound hook that counts how many times the
 * underlying default loader was invoked (i.e. cache misses). Mirrors the
 * shape used by cmdCheck.
 */
function buildCachingLoader(workspaceDir: string): {
  load: (manifestPath: string) => LoadedCompound;
  parseCallCount: () => number;
} {
  const cache = createManifestCache(workspaceDir);
  let parseCalls = 0;
  return {
    load: (manifestPath: string): LoadedCompound => {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const hash = contentHash(raw);
      const cached = cache.getCompound(manifestPath, hash);
      if (cached !== null) return cached;
      parseCalls++;
      const parsed = defaultLoadCompound(manifestPath);
      cache.setCompound(manifestPath, parsed, hash);
      return parsed;
    },
    parseCallCount: () => parseCalls,
  };
}

describe("per-compound cache granularity", () => {
  it("editing one compound's manifest re-parses only that compound", () => {
    const wsPath = setupWorkspace(["alpha", "beta", "gamma"]);
    const ws = loadWorkspace(wsPath);
    const wsDir = path.dirname(wsPath);

    // First pass — cold cache. All three compounds parse.
    const first = buildCachingLoader(wsDir);
    const r1 = discoverCompounds(ws, wsDir, { loadCompound: first.load });
    expect(r1.map((c) => c.manifest.compound).sort()).toEqual(["alpha", "beta", "gamma"]);
    expect(first.parseCallCount()).toBe(3);

    // Mutate beta's compound.yaml so its content hash changes.
    fs.writeFileSync(
      path.join(wsDir, "src/compounds/beta/compound.yaml"),
      "compound: beta\ndescription: changed\n",
      "utf-8",
    );

    // Second pass — same on-disk cache, fresh in-memory counter.
    const second = buildCachingLoader(wsDir);
    const r2 = discoverCompounds(ws, wsDir, { loadCompound: second.load });
    expect(r2.map((c) => c.manifest.compound).sort()).toEqual(["alpha", "beta", "gamma"]);

    // Only beta should have been re-parsed; alpha + gamma served from cache.
    expect(second.parseCallCount()).toBe(1);

    // Sanity: the beta entry in the second pass reflects the new content.
    const beta = r2.find((c) => c.manifest.compound === "beta");
    expect(beta?.manifest.description).toBe("changed");

    // Sibling alpha was returned from cache (no parse call).
    const alpha = r2.find((c) => c.manifest.compound === "alpha");
    expect(alpha).toBeTruthy();
  });

  it("a loadCompound-level wrapper records exactly one parse call on the second pass", () => {
    // Wraps the default loadCompound (the loader's own implementation) and
    // counts how many times the underlying YAML parse path is exercised. The
    // spec text recommends "spy/counter on parseYaml or wrap the private
    // loadCompound" — the second form, which is portable across ESM/CJS.
    const wsPath = setupWorkspace(["alpha", "beta", "gamma"]);
    const ws = loadWorkspace(wsPath);
    const wsDir = path.dirname(wsPath);

    // Cold pass — populate cache.
    const cold = buildCachingLoader(wsDir);
    discoverCompounds(ws, wsDir, { loadCompound: cold.load });

    // Mutate alpha.
    fs.writeFileSync(
      path.join(wsDir, "src/compounds/alpha/compound.yaml"),
      "compound: alpha\ndescription: edited\n",
      "utf-8",
    );

    // Build a warm loader where the parse path is wrapped explicitly so we
    // count *only* invocations of the underlying defaultLoadCompound.
    let parseCalls = 0;
    const warmCache = createManifestCache(wsDir);
    const warmLoad = (manifestPath: string): LoadedCompound => {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const hash = contentHash(raw);
      const cached = warmCache.getCompound(manifestPath, hash);
      if (cached !== null) return cached;
      parseCalls++;
      const parsed = defaultLoadCompound(manifestPath);
      warmCache.setCompound(manifestPath, parsed, hash);
      return parsed;
    };
    discoverCompounds(ws, wsDir, { loadCompound: warmLoad });

    // Exactly one parse: the mutated alpha. Beta + gamma served from cache.
    expect(parseCalls).toBe(1);
  });
});

describe("second discoverCompounds run is fast (warm path)", () => {
  it("second pass on a 5-compound workspace completes in < 300 ms", () => {
    const names = ["a", "b", "c", "d", "e"];
    const wsPath = setupWorkspace(names);
    const ws = loadWorkspace(wsPath);
    const wsDir = path.dirname(wsPath);

    // Prime the cache.
    const prime = buildCachingLoader(wsDir);
    discoverCompounds(ws, wsDir, { loadCompound: prime.load });

    // Warm pass — measure.
    const warm = buildCachingLoader(wsDir);
    const start = performance.now();
    discoverCompounds(ws, wsDir, { loadCompound: warm.load });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(300);
    // And no re-parses.
    expect(warm.parseCallCount()).toBe(0);
  });
});
