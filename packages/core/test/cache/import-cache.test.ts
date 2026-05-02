import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ParsedImport } from "@chemag/core/types";
import { createImportCache } from "../../src/cache/import-cache.js";
import { __resetCacheStateForTesting } from "../../src/cache/cache-state.js";

let workspaceDir: string;
let cacheDir: string;

beforeEach(() => {
  __resetCacheStateForTesting();
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-impcache-"));
  cacheDir = path.join(workspaceDir, ".chemag", "cache");
});

afterEach(() => {
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

const SAMPLE: ParsedImport[] = [
  { moduleSpecifier: "../shared/util", names: ["foo"], isTypeOnly: false },
  { moduleSpecifier: "node:path", names: ["join"], isTypeOnly: false },
];

describe("ImportCache — round-trip", () => {
  it("stores and retrieves parsed imports by file path + content hash", () => {
    const cache = createImportCache(workspaceDir);
    const filePath = path.join(workspaceDir, "src/x/file.ts");

    expect(cache.get(filePath, "h1")).toBeNull();
    cache.set(filePath, SAMPLE, "h1");
    const got = cache.get(filePath, "h1");
    expect(got).toEqual(SAMPLE);
  });

  it("returns null on hash mismatch", () => {
    const cache = createImportCache(workspaceDir);
    const filePath = path.join(workspaceDir, "src/x/file.ts");
    cache.set(filePath, SAMPLE, "h1");
    expect(cache.get(filePath, "h2")).toBeNull();
  });

  it("returns null on miss", () => {
    const cache = createImportCache(workspaceDir);
    expect(cache.get("/no/such/file.ts", "h")).toBeNull();
  });

  it("creates the cache root on first write", () => {
    expect(fs.existsSync(cacheDir)).toBe(false);
    const cache = createImportCache(workspaceDir);
    cache.set(path.join(workspaceDir, "src/file.ts"), SAMPLE, "h");
    expect(fs.existsSync(cacheDir)).toBe(true);
  });

  it("isolates entries with different extensions but same stem", () => {
    const cache = createImportCache(workspaceDir);
    const a = path.join(workspaceDir, "src/x/file.ts");
    const b = path.join(workspaceDir, "src/x/file.tsx");
    cache.set(a, SAMPLE, "ha");
    cache.set(b, [{ moduleSpecifier: "diff", names: [], isTypeOnly: false }], "hb");
    // The bucket is content-hashed on the ext-stripped path so a and b share
    // a directory; but the per-content-hash file naming keeps them distinct.
    expect(cache.get(a, "ha")).toEqual(SAMPLE);
    expect(cache.get(b, "hb")).not.toEqual(SAMPLE);
  });

  it("respects CHEMAG_CACHE_DIR override", () => {
    const altDir = path.join(workspaceDir, "alt-cache");
    process.env.CHEMAG_CACHE_DIR = altDir;
    const cache = createImportCache(workspaceDir);
    cache.set(path.join(workspaceDir, "src/file.ts"), SAMPLE, "h");
    expect(fs.existsSync(altDir)).toBe(true);
    expect(fs.existsSync(cacheDir)).toBe(false);
  });
});

describe("ImportCache — concurrency", () => {
  it("survives concurrent writes without corruption", async () => {
    const cache = createImportCache(workspaceDir);
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      writes.push(
        Promise.resolve().then(() => {
          cache.set(
            path.join(workspaceDir, `src/file${i}.ts`),
            [{ moduleSpecifier: `m${i}`, names: [`n${i}`], isTypeOnly: false }],
            `h${i}`,
          );
        }),
      );
    }
    await Promise.all(writes);

    for (let i = 0; i < 20; i++) {
      const got = cache.get(path.join(workspaceDir, `src/file${i}.ts`), `h${i}`);
      expect(got).toEqual([{ moduleSpecifier: `m${i}`, names: [`n${i}`], isTypeOnly: false }]);
    }
  });
});
