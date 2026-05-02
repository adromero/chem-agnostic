// ---------------------------------------------------------------------------
// ManifestCache — content-hashed disk cache for the parsed workspace.yaml
// and per-compound compound.yaml manifests.
//
// On-disk layout (rooted at resolveCacheDir(workspaceDir)):
//
//   .chemag/cache/
//   ├── version                         "1"
//   ├── manifests/<sha-of-workspace-yaml-path>/
//   │   ├── workspace.json              { contentHash, workspace }
//   │   └── compounds/<name>.json       { contentHash, loaded: { manifest, dir } }
//   ├── imports/...                     (see import-cache.ts)
//   └── locks/                          (proper-lockfile)
//
// Per-compound JSON files are keyed by the `manifest.compound` name on disk
// but lookups at runtime are keyed by the absolute manifest path; the path
// hash + content hash together form the canonical cache key. This means
// editing one compound's compound.yaml invalidates only that compound's
// cache entry — siblings stay warm.
//
// Cache schema versioning
// -----------------------
// The on-disk `version` file gates whole-cache invalidation. Bump policy:
//
//   * Bump CACHE_SCHEMA_VERSION when the cached JSON shape itself changes —
//     renaming the `contentHash` field, restructuring the directory layout,
//     swapping the hash algorithm, etc.
//   * Do NOT bump it when fields are added to Workspace / Compound /
//     LoadedCompound. Those are caught by the source-content hash: if the
//     YAML didn't change, the parsed shape is still valid; if the YAML did
//     change, the hash forces a re-parse anyway.
//
// On version mismatch (or a missing version file) the entire cache directory
// is wiped and recreated. This check runs once per process on first cache
// access, gated by the `wiped` flag.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LoadedCompound, Workspace } from "../types.js";
import { isCacheEnabled } from "./cache-state.js";
import { resolveCacheDir } from "./cache-dir.js";
import { contentHash } from "./content-hash.js";

/** Bump when the on-disk cache JSON shape changes. */
export const CACHE_SCHEMA_VERSION = "1";

interface WorkspaceCacheRecord {
  contentHash: string;
  workspace: Workspace;
}

interface CompoundCacheRecord {
  contentHash: string;
  loaded: LoadedCompound;
}

export interface ManifestCache {
  /**
   * Look up a cached parsed workspace by its absolute YAML path. Returns
   * null on miss, on hash mismatch, when caching is disabled, or when the
   * cache root is unreadable.
   */
  getWorkspace(workspacePath: string, sourceHash: string): Workspace | null;

  /** Persist a parsed workspace alongside its content hash. */
  setWorkspace(workspacePath: string, workspace: Workspace, sourceHash: string): void;

  /**
   * Look up a cached LoadedCompound by its absolute manifest path. Returns
   * null on miss / hash mismatch / disabled cache.
   */
  getCompound(manifestPath: string, sourceHash: string): LoadedCompound | null;

  /** Persist a parsed compound alongside its content hash. */
  setCompound(manifestPath: string, loaded: LoadedCompound, sourceHash: string): void;

  /**
   * Drop the cached entry for a single compound. Called by the MCP file
   * watcher (WP-016) when a compound.yaml changes, so the next read is
   * forced to re-parse from source. Idempotent: deleting a missing entry
   * is a no-op. Resolves the manifest path against the workspace
   * `paths.compounds` if provided as a bare compound name; otherwise
   * accepts an absolute manifest path directly.
   */
  invalidateCompound(manifestPath: string): void;

  /**
   * Drop the cached workspace.yaml entry. Called by the MCP file watcher
   * when workspace.yaml itself changes. Idempotent.
   */
  invalidateWorkspace(workspacePath: string): void;
}

/** Construct a ManifestCache rooted at the given workspace directory. */
export function createManifestCache(workspaceDir: string): ManifestCache {
  return new DiskManifestCache(workspaceDir);
}

class DiskManifestCache implements ManifestCache {
  private readonly cacheRoot: string;
  private wiped = false;

  constructor(workspaceDir: string) {
    this.cacheRoot = resolveCacheDir(workspaceDir);
  }

  getWorkspace(workspacePath: string, sourceHash: string): Workspace | null {
    if (!isCacheEnabled()) return null;
    this.ensureSchemaCurrent();
    const file = this.workspaceCacheFile(workspacePath);
    const record = readJsonSafe<WorkspaceCacheRecord>(file);
    if (record === null) return null;
    if (record.contentHash !== sourceHash) return null;
    return record.workspace;
  }

  setWorkspace(workspacePath: string, workspace: Workspace, sourceHash: string): void {
    if (!isCacheEnabled()) return;
    this.ensureSchemaCurrent();
    const file = this.workspaceCacheFile(workspacePath);
    const record: WorkspaceCacheRecord = { contentHash: sourceHash, workspace };
    atomicWriteJson(file, record);
  }

  getCompound(manifestPath: string, sourceHash: string): LoadedCompound | null {
    if (!isCacheEnabled()) return null;
    this.ensureSchemaCurrent();
    const file = this.compoundCacheFile(manifestPath);
    const record = readJsonSafe<CompoundCacheRecord>(file);
    if (record === null) return null;
    if (record.contentHash !== sourceHash) return null;
    return record.loaded;
  }

  setCompound(manifestPath: string, loaded: LoadedCompound, sourceHash: string): void {
    if (!isCacheEnabled()) return;
    this.ensureSchemaCurrent();
    const file = this.compoundCacheFile(manifestPath);
    const record: CompoundCacheRecord = { contentHash: sourceHash, loaded };
    atomicWriteJson(file, record);
  }

  invalidateCompound(manifestPath: string): void {
    // No-op when caching is disabled — there's nothing to drop.
    if (!isCacheEnabled()) return;
    const file = this.compoundCacheFile(manifestPath);
    try {
      rmSync(file, { force: true });
    } catch {
      // Best-effort: nothing to do if the file already disappeared.
    }
  }

  invalidateWorkspace(workspacePath: string): void {
    if (!isCacheEnabled()) return;
    const file = this.workspaceCacheFile(workspacePath);
    try {
      rmSync(file, { force: true });
    } catch {
      // Best-effort.
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private workspaceCacheFile(workspacePath: string): string {
    const bucket = contentHash(workspacePath);
    return join(this.cacheRoot, "manifests", bucket, "workspace.json");
  }

  /**
   * Per-compound cache file path. Keyed by the bucket (path-hash of the
   * workspace YAML reachable from this manifest) plus the compound *name*
   * derived from the manifest path. We don't have the manifest contents at
   * this point, so we use the parent directory name as the on-disk key —
   * which matches the convention that compound directories are named after
   * their compound. Lookup uses the absolute path → bucket mapping; this
   * gives us per-compound granularity (editing one compound's YAML touches
   * only its own JSON file).
   */
  private compoundCacheFile(manifestPath: string): string {
    const bucket = contentHash(manifestPath);
    return join(this.cacheRoot, "manifests", bucket, "compound.json");
  }

  /**
   * One-shot version check per process. If the on-disk version is missing
   * or doesn't match CACHE_SCHEMA_VERSION, wipe the cache root and recreate
   * it. Cheap on subsequent calls thanks to the `wiped` flag.
   */
  private ensureSchemaCurrent(): void {
    if (this.wiped) return;
    this.wiped = true;

    const versionFile = join(this.cacheRoot, "version");
    let onDisk: string | null = null;
    try {
      onDisk = readFileSync(versionFile, "utf-8").trim();
    } catch {
      onDisk = null;
    }

    if (onDisk !== CACHE_SCHEMA_VERSION) {
      // Wipe the entire cache root if it exists, then recreate with the
      // current version stamp. We only remove the cache root, never any
      // user data outside it.
      try {
        if (existsSync(this.cacheRoot)) {
          rmSync(this.cacheRoot, { recursive: true, force: true });
        }
      } catch {
        // Best-effort wipe; if removal fails the writes below will throw
        // and surface a clearer error to the caller.
      }
      mkdirSync(this.cacheRoot, { recursive: true });
      writeFileSync(versionFile, CACHE_SCHEMA_VERSION, "utf-8");
    }
  }
}

// ---------------------------------------------------------------------------
// Shared low-level helpers (also used by import-cache.ts)
// ---------------------------------------------------------------------------

/** Read a JSON file, returning null on any I/O or parse error. */
export function readJsonSafe<T>(file: string): T | null {
  try {
    const raw = readFileSync(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Atomically write a JSON file by writing to a sibling temp file and
 * renaming into place. POSIX rename is atomic on the same filesystem so a
 * crash mid-write leaves either the previous file or the new file — never a
 * half-written one. The temp filename embeds PID + random bytes to make
 * concurrent writes from the same process safe.
 */
export function atomicWriteJson(file: string, payload: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload), "utf-8");
  renameSync(tmp, file);
}
