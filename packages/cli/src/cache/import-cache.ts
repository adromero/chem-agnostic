// ---------------------------------------------------------------------------
// ImportCache — content-hashed disk cache for ParsedImport[] arrays.
//
// Imports parsing for a single file is a pure function of the file contents
// (and the parser version). We hash the file contents and persist the parsed
// imports under `imports/<ext-stripped-hash>/<content-hash>.json`. The
// ext-stripped-hash bucket is a hash of the source path with extension
// stripped — it groups related files together while keeping siblings in
// distinct directories, which avoids any single directory growing to tens of
// thousands of entries on large monorepos.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import type { ParsedImport } from "@chemag/core/types";
import { atomicWriteJson, readJsonSafe } from "./manifest-cache.js";
import { isCacheEnabled } from "./cache-state.js";
import { resolveCacheDir } from "./cache-dir.js";
import { contentHash } from "./content-hash.js";

interface ImportCacheRecord {
  contentHash: string;
  imports: ParsedImport[];
}

export interface ImportCache {
  /**
   * Look up cached parsed imports for a source file. Returns null on miss,
   * hash mismatch, or when the cache is disabled.
   */
  get(filePath: string, sourceHash: string): ParsedImport[] | null;

  /** Persist parsed imports alongside the source content hash. */
  set(filePath: string, imports: ParsedImport[], sourceHash: string): void;
}

/** Construct an ImportCache rooted at the given workspace directory. */
export function createImportCache(workspaceDir: string): ImportCache {
  return new DiskImportCache(workspaceDir);
}

class DiskImportCache implements ImportCache {
  private readonly cacheRoot: string;

  constructor(workspaceDir: string) {
    this.cacheRoot = resolveCacheDir(workspaceDir);
  }

  get(filePath: string, sourceHash: string): ParsedImport[] | null {
    if (!isCacheEnabled()) return null;
    const file = this.fileFor(filePath, sourceHash);
    const record = readJsonSafe<ImportCacheRecord>(file);
    if (record === null) return null;
    if (record.contentHash !== sourceHash) return null;
    return record.imports;
  }

  set(filePath: string, imports: ParsedImport[], sourceHash: string): void {
    if (!isCacheEnabled()) return;
    const file = this.fileFor(filePath, sourceHash);
    const record: ImportCacheRecord = { contentHash: sourceHash, imports };
    atomicWriteJson(file, record);
  }

  private fileFor(filePath: string, sourceHash: string): string {
    const bucket = contentHash(stripExt(filePath));
    return join(this.cacheRoot, "imports", bucket, `${sourceHash}.json`);
  }
}

/** Strip the trailing file extension (if any) from a path string. */
function stripExt(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (dot > slash) return filePath.slice(0, dot);
  return filePath;
}
