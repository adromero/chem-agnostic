// ---------------------------------------------------------------------------
// Cache enable/disable state.
//
// The CLI dispatcher resolves --no-cache early (analogous to --vocabulary)
// and toggles this module-local flag. Cache implementations consult
// `isCacheEnabled()` on every call and short-circuit (no read, no write)
// when the flag is `false`.
//
// Tests reset the flag via `__resetCacheStateForTesting()`.
// ---------------------------------------------------------------------------

let enabled = true;

/** Toggle whether the cache layer is active for the rest of the process. */
export function setCacheEnabled(value: boolean): void {
  enabled = value;
}

/** Returns true if cache reads/writes are permitted. */
export function isCacheEnabled(): boolean {
  return enabled;
}

/**
 * Reset module-local state to factory defaults. Tests use this in beforeEach
 * to keep cases isolated.
 */
export function __resetCacheStateForTesting(): void {
  enabled = true;
}
