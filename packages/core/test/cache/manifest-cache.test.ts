import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LoadedCompound, Workspace } from "@chemag/core/types";
import { CACHE_SCHEMA_VERSION, createManifestCache } from "../../src/cache/manifest-cache.js";
import { __resetCacheStateForTesting } from "../../src/cache/cache-state.js";
import { resolveCacheDir } from "../../src/cache/cache-dir.js";

let workspaceDir: string;
let cacheDir: string;

beforeEach(() => {
  __resetCacheStateForTesting();
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-mfcache-"));
  cacheDir = path.join(workspaceDir, ".chemag", "cache");
});

afterEach(() => {
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

function makeWorkspace(name = "test"): Workspace {
  return {
    workspace: name,
    language: "typescript",
    roles: { element: { description: "", folder: "elements" } },
    bonds: { element: ["element"] },
    paths: { compounds: "./src/compounds" },
  };
}

function makeCompound(name = "billing"): LoadedCompound {
  return {
    manifest: {
      compound: name,
      units: [{ role: "element", name: "Id", file: "./elements/Id.ts" }],
    },
    dir: path.join(workspaceDir, "src", "compounds", name),
  };
}

describe("ManifestCache — round-trip", () => {
  it("stores and retrieves a workspace by path + content hash", () => {
    const cache = createManifestCache(workspaceDir);
    const wsPath = path.join(workspaceDir, "workspace.yaml");
    const ws = makeWorkspace();

    expect(cache.getWorkspace(wsPath, "h1")).toBeNull();
    cache.setWorkspace(wsPath, ws, "h1");
    const got = cache.getWorkspace(wsPath, "h1");
    expect(got).not.toBeNull();
    expect(got?.workspace).toBe("test");
    expect(got?.roles.element.folder).toBe("elements");
  });

  it("stores and retrieves a compound by manifest path + content hash", () => {
    const cache = createManifestCache(workspaceDir);
    const manifestPath = path.join(workspaceDir, "src/compounds/billing/compound.yaml");
    const loaded = makeCompound("billing");

    cache.setCompound(manifestPath, loaded, "h1");
    const got = cache.getCompound(manifestPath, "h1");
    expect(got).not.toBeNull();
    expect(got?.manifest.compound).toBe("billing");
    expect(got?.dir).toBe(loaded.dir);
  });

  it("returns null on miss", () => {
    const cache = createManifestCache(workspaceDir);
    expect(cache.getWorkspace("/no/such/path", "h")).toBeNull();
    expect(cache.getCompound("/no/such/manifest", "h")).toBeNull();
  });
});

describe("ManifestCache — content-hash invalidation", () => {
  it("returns null when the source hash changes (workspace)", () => {
    const cache = createManifestCache(workspaceDir);
    const wsPath = path.join(workspaceDir, "workspace.yaml");
    cache.setWorkspace(wsPath, makeWorkspace("v1"), "h1");
    expect(cache.getWorkspace(wsPath, "h1")?.workspace).toBe("v1");
    expect(cache.getWorkspace(wsPath, "h2")).toBeNull();
  });

  it("returns null when the source hash changes (compound)", () => {
    const cache = createManifestCache(workspaceDir);
    const manifestPath = path.join(workspaceDir, "src/compounds/x/compound.yaml");
    cache.setCompound(manifestPath, makeCompound("x"), "h1");
    expect(cache.getCompound(manifestPath, "h1")?.manifest.compound).toBe("x");
    expect(cache.getCompound(manifestPath, "h2")).toBeNull();
  });
});

describe("ManifestCache — schema version", () => {
  it("creates the version file on first access", () => {
    const cache = createManifestCache(workspaceDir);
    cache.setWorkspace(path.join(workspaceDir, "workspace.yaml"), makeWorkspace(), "h");
    const versionFile = path.join(cacheDir, "version");
    expect(fs.existsSync(versionFile)).toBe(true);
    expect(fs.readFileSync(versionFile, "utf-8")).toBe(CACHE_SCHEMA_VERSION);
  });

  it("wipes the cache when the on-disk version doesn't match", () => {
    // Pre-populate a "fake old" cache layout with a stale value.
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "version"), "999", "utf-8");
    const stalePath = path.join(cacheDir, "manifests", "stale-bucket");
    fs.mkdirSync(stalePath, { recursive: true });
    fs.writeFileSync(path.join(stalePath, "stale.json"), "{}", "utf-8");

    const cache = createManifestCache(workspaceDir);
    // Trigger the schema check via a write.
    cache.setWorkspace(path.join(workspaceDir, "workspace.yaml"), makeWorkspace(), "h");

    // Stale dir should be gone; version file should reflect the current schema.
    expect(fs.existsSync(stalePath)).toBe(false);
    expect(fs.readFileSync(path.join(cacheDir, "version"), "utf-8")).toBe(CACHE_SCHEMA_VERSION);
  });

  it("wipes the cache when the version file is missing entirely", () => {
    fs.mkdirSync(cacheDir, { recursive: true });
    const stalePath = path.join(cacheDir, "manifests", "stale-bucket");
    fs.mkdirSync(stalePath, { recursive: true });
    fs.writeFileSync(path.join(stalePath, "stale.json"), "{}", "utf-8");
    // Note: no version file written.

    const cache = createManifestCache(workspaceDir);
    cache.setWorkspace(path.join(workspaceDir, "workspace.yaml"), makeWorkspace(), "h");

    expect(fs.existsSync(stalePath)).toBe(false);
    expect(fs.readFileSync(path.join(cacheDir, "version"), "utf-8")).toBe(CACHE_SCHEMA_VERSION);
  });

  it("does not re-wipe on subsequent accesses within the same instance", () => {
    const cache = createManifestCache(workspaceDir);
    const wsPath = path.join(workspaceDir, "workspace.yaml");
    cache.setWorkspace(wsPath, makeWorkspace(), "h1");

    // Write our own marker file in the cache root after the first call.
    const marker = path.join(cacheDir, "marker.txt");
    fs.writeFileSync(marker, "preserved", "utf-8");

    // Subsequent calls must NOT wipe the cache.
    cache.setCompound(
      path.join(workspaceDir, "src/compounds/x/compound.yaml"),
      makeCompound(),
      "h2",
    );
    expect(fs.existsSync(marker)).toBe(true);
  });
});

describe("ManifestCache — atomic writes", () => {
  it("does not leave .tmp files behind on a successful write", () => {
    const cache = createManifestCache(workspaceDir);
    const wsPath = path.join(workspaceDir, "workspace.yaml");
    cache.setWorkspace(wsPath, makeWorkspace(), "h1");
    const bucket = collectFiles(cacheDir);
    const tmpFiles = bucket.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toEqual([]);
  });

  it("survives concurrent writes without corruption", async () => {
    const cache = createManifestCache(workspaceDir);
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      writes.push(
        Promise.resolve().then(() => {
          cache.setCompound(
            path.join(workspaceDir, `src/compounds/c${i}/compound.yaml`),
            makeCompound(`c${i}`),
            `h${i}`,
          );
        }),
      );
    }
    await Promise.all(writes);

    // Every entry must be readable and parse cleanly.
    for (let i = 0; i < 20; i++) {
      const got = cache.getCompound(
        path.join(workspaceDir, `src/compounds/c${i}/compound.yaml`),
        `h${i}`,
      );
      expect(got, `entry c${i} should round-trip`).not.toBeNull();
      expect(got?.manifest.compound).toBe(`c${i}`);
    }
  });

  it("survives concurrent writes to the SAME entry (last writer wins, no corruption)", async () => {
    const cache = createManifestCache(workspaceDir);
    const manifestPath = path.join(workspaceDir, "src/compounds/race/compound.yaml");

    const writes: Promise<void>[] = [];
    for (let i = 0; i < 30; i++) {
      writes.push(
        Promise.resolve().then(() => {
          cache.setCompound(manifestPath, makeCompound("race"), `h${i}`);
        }),
      );
    }
    await Promise.all(writes);

    // The file must exist and be parseable as valid JSON. The exact "winning"
    // hash is a race, but the content must be intact (not half-written).
    const allFiles = collectFiles(cacheDir);
    const compoundFiles = allFiles.filter((f) => f.endsWith("compound.json"));
    expect(compoundFiles.length).toBeGreaterThan(0);
    for (const f of compoundFiles) {
      const raw = fs.readFileSync(f, "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
      expect(JSON.parse(raw)).toMatchObject({
        contentHash: expect.stringMatching(/^h\d+$/),
        loaded: { manifest: { compound: "race" } },
      });
    }

    // No leftover .tmp files.
    expect(allFiles.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("ManifestCache — directory creation", () => {
  it("creates the cache root on first write if missing", () => {
    expect(fs.existsSync(cacheDir)).toBe(false);
    const cache = createManifestCache(workspaceDir);
    cache.setWorkspace(path.join(workspaceDir, "workspace.yaml"), makeWorkspace(), "h");
    expect(fs.existsSync(cacheDir)).toBe(true);
  });

  it("respects CHEMAG_CACHE_DIR override", () => {
    const overrideDir = path.join(workspaceDir, "alt-cache");
    process.env.CHEMAG_CACHE_DIR = overrideDir;
    expect(resolveCacheDir(workspaceDir)).toBe(overrideDir);

    const cache = createManifestCache(workspaceDir);
    cache.setWorkspace(path.join(workspaceDir, "workspace.yaml"), makeWorkspace(), "h");
    expect(fs.existsSync(overrideDir)).toBe(true);
    // Default location should NOT be created.
    expect(fs.existsSync(cacheDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(p));
    else out.push(p);
  }
  return out;
}
