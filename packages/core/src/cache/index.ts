// ---------------------------------------------------------------------------
// Public surface of the cache subsystem. Re-exports the entry points used by
// CLI commands, the MCP server, and any future consumer that needs to honor
// the workspace's manifest / import caches.
//
// Inter-package imports MUST go through "@chemag/core/cache" — never via deep
// relative paths into this directory.
// ---------------------------------------------------------------------------

export {
  CACHE_DIR_ENV_VAR,
  DEFAULT_CACHE_DIR_NAME,
  resolveCacheDir,
} from "./cache-dir.js";

export {
  __resetCacheStateForTesting,
  isCacheEnabled,
  setCacheEnabled,
} from "./cache-state.js";

export { contentHash } from "./content-hash.js";

export {
  createImportCache,
  type ImportCache,
} from "./import-cache.js";

export {
  CACHE_SCHEMA_VERSION,
  atomicWriteJson,
  createManifestCache,
  type ManifestCache,
  readJsonSafe,
} from "./manifest-cache.js";
