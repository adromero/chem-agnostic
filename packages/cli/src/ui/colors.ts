// ---------------------------------------------------------------------------
// UI: colors
//
// Thin wrapper over `picocolors`. `picocolors` already honors `NO_COLOR=1` and
// non-TTY destinations natively (its `.isColorSupported` check looks at
// `NO_COLOR`, `FORCE_COLOR`, `process.stdout.isTTY`, etc.). We re-export the
// styling functions and add a `stripAnsi` helper used by tests + by callers
// that want to format for non-color sinks.
//
// We do NOT cache `pc` import-time — callers may set/unset `NO_COLOR` between
// invocations (especially tests), so each helper consults `pc` fresh.
// ---------------------------------------------------------------------------

import pc from "picocolors";

/**
 * True if color output is supported on the current stdout. Mirrors picocolors'
 * own logic: NO_COLOR=1 disables; explicit FORCE_COLOR enables; otherwise
 * defaults to whether stdout is a TTY.
 */
export function isColorSupported(): boolean {
  return pc.isColorSupported;
}

export const colors = {
  bold: (s: string): string => pc.bold(s),
  dim: (s: string): string => pc.dim(s),
  red: (s: string): string => pc.red(s),
  green: (s: string): string => pc.green(s),
  yellow: (s: string): string => pc.yellow(s),
  blue: (s: string): string => pc.blue(s),
  cyan: (s: string): string => pc.cyan(s),
  magenta: (s: string): string => pc.magenta(s),
  gray: (s: string): string => pc.gray(s),
  underline: (s: string): string => pc.underline(s),
};

// ANSI escape sequence pattern. Built via RegExp constructor + fromCharCode
// so the source file contains no literal control bytes (biome's
// noControlCharactersInRegex rule doesn't permit them). ESC = 0x1b (7-bit),
// CSI = 0x9b (8-bit single CSI). Matches the standard SGR + cursor + screen
// sequences emitted by nanospinner / picocolors / citty.
const ESC = String.fromCharCode(0x1b);
const CSI = String.fromCharCode(0x9b);
const ANSI_RE = new RegExp(
  `[${ESC}${CSI}][[()#;?]*(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PRZcf-ntqry=><~]`,
  "g",
);

/**
 * Remove all ANSI escape sequences from a string. Useful for snapshotting and
 * tests that want to assert plain text under NO_COLOR.
 */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "");
}
