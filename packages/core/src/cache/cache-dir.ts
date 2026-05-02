// ---------------------------------------------------------------------------
// Resolve the on-disk cache directory.
//
// Default: `<workspaceDir>/.chemag/cache` — co-located with workspace.yaml so
// each project gets its own cache.
//
// Override: when the CHEMAG_CACHE_DIR environment variable is set the cache
// lives there instead. The override is consulted on every call, not cached,
// so tests that mutate process.env between assertions see the right value.
// ---------------------------------------------------------------------------

import { isAbsolute, join, resolve } from "node:path";

/** Environment variable that overrides the default cache directory. */
export const CACHE_DIR_ENV_VAR = "CHEMAG_CACHE_DIR";

/** Default subdirectory (relative to the workspace) used when the env var is unset. */
export const DEFAULT_CACHE_DIR_NAME = ".chemag/cache";

/**
 * Resolve the cache directory for a given workspace.
 *
 * @param workspaceDir absolute path to the workspace (the directory containing
 * workspace.yaml). When the env var is set this argument is ignored unless the
 * override is a relative path, in which case it is resolved against the
 * workspace dir.
 */
export function resolveCacheDir(workspaceDir: string): string {
  const override = process.env[CACHE_DIR_ENV_VAR];
  if (override !== undefined && override.length > 0) {
    return isAbsolute(override) ? override : resolve(workspaceDir, override);
  }
  return join(workspaceDir, DEFAULT_CACHE_DIR_NAME);
}
