import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  __resetCacheStateForTesting,
  isCacheEnabled,
  setCacheEnabled,
} from "../../src/cache/cache-state.js";
import { createImportCache } from "../../src/cache/import-cache.js";
import { createManifestCache } from "../../src/cache/manifest-cache.js";

let tmpDir: string;

beforeEach(() => {
  __resetCacheStateForTesting();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-cache-state-"));
  // Force the cache root inside our tmp dir so we can assert no writes leak.
  process.env.CHEMAG_CACHE_DIR = path.join(tmpDir, "cache");
});

afterEach(() => {
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("cache-state", () => {
  it("defaults to enabled", () => {
    expect(isCacheEnabled()).toBe(true);
  });

  it("setCacheEnabled(false) disables it; setCacheEnabled(true) re-enables", () => {
    setCacheEnabled(false);
    expect(isCacheEnabled()).toBe(false);
    setCacheEnabled(true);
    expect(isCacheEnabled()).toBe(true);
  });

  it("__resetCacheStateForTesting restores the default", () => {
    setCacheEnabled(false);
    expect(isCacheEnabled()).toBe(false);
    __resetCacheStateForTesting();
    expect(isCacheEnabled()).toBe(true);
  });
});

describe("cache implementations short-circuit when disabled", () => {
  it("ManifestCache.getCompound returns null and writes nothing when disabled", () => {
    const cache = createManifestCache(tmpDir);
    const manifestPath = "/some/abs/path/compound.yaml";
    const loaded = { manifest: { compound: "x" }, dir: "/some/abs/path" };

    setCacheEnabled(false);
    cache.setCompound(manifestPath, loaded, "abc");
    expect(cache.getCompound(manifestPath, "abc")).toBeNull();

    // Cache root is not even created.
    expect(fs.existsSync(path.join(tmpDir, "cache"))).toBe(false);
  });

  it("ManifestCache.getWorkspace returns null when disabled even if a record exists on disk", () => {
    const cache = createManifestCache(tmpDir);
    const wsPath = "/abs/workspace.yaml";
    const ws = {
      workspace: "test",
      language: "typescript",
      roles: { element: { description: "", folder: "elements" } },
      bonds: { element: ["element"] },
      paths: { compounds: "./src/compounds" },
    } as never;

    // Populate while enabled
    cache.setWorkspace(wsPath, ws, "h");
    expect(cache.getWorkspace(wsPath, "h")).not.toBeNull();

    // Toggle off — reads short-circuit
    setCacheEnabled(false);
    expect(cache.getWorkspace(wsPath, "h")).toBeNull();
  });

  it("ImportCache short-circuits both reads and writes when disabled", () => {
    const cache = createImportCache(tmpDir);
    setCacheEnabled(false);
    cache.set("/abs/file.ts", [{ moduleSpecifier: "x", names: [], isTypeOnly: false }], "h");
    expect(cache.get("/abs/file.ts", "h")).toBeNull();
    expect(fs.existsSync(path.join(tmpDir, "cache"))).toBe(false);
  });

  it("re-enabling restores read/write behavior", () => {
    const cache = createManifestCache(tmpDir);
    const manifestPath = "/abs/x/compound.yaml";
    const loaded = { manifest: { compound: "x" }, dir: "/abs/x" };

    setCacheEnabled(false);
    cache.setCompound(manifestPath, loaded, "h1");
    expect(cache.getCompound(manifestPath, "h1")).toBeNull();

    setCacheEnabled(true);
    cache.setCompound(manifestPath, loaded, "h1");
    const got = cache.getCompound(manifestPath, "h1");
    expect(got).not.toBeNull();
    expect(got?.manifest.compound).toBe("x");
  });
});
