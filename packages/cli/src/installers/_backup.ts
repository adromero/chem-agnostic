// ---------------------------------------------------------------------------
// `.bak` file management for installers.
//
// Policy: write the backup ONCE — on the very first install only. Subsequent
// installs do not overwrite it; that way the user's pre-chemag state is never
// lost across re-runs. `--restore` copies `<path>.bak` back to `<path>`.
//
// All paths are absolute; the caller is responsible for resolving them.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";

/**
 * Write `<path>.bak` if and only if it does not already exist.
 * Returns true if the backup was created, false if it already existed
 * (or the source file does not exist).
 */
export function writeBackupOnce(path: string): boolean {
  if (!fs.existsSync(path)) return false;
  const bak = `${path}.bak`;
  if (fs.existsSync(bak)) return false;
  fs.copyFileSync(path, bak);
  return true;
}

/**
 * Restore `<path>` from `<path>.bak`. Returns true on success, false if the
 * backup does not exist (caller should surface a clear error in that case).
 */
export function restoreFromBackup(path: string): boolean {
  const bak = `${path}.bak`;
  if (!fs.existsSync(bak)) return false;
  fs.copyFileSync(bak, path);
  return true;
}

/**
 * True iff the backup file exists. Useful for status / dry-run output.
 */
export function backupExists(path: string): boolean {
  return fs.existsSync(`${path}.bak`);
}
