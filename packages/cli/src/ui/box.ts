// ---------------------------------------------------------------------------
// UI: box
//
// Minimal boxen-style framing for grouping help-output blocks. We deliberately
// avoid pulling in the `boxen` package — the dependency graph (chalk,
// string-width, etc.) is not worth a single feature here. The output is plain
// ASCII and respects NO_COLOR / non-TTY automatically because color comes via
// the `colors` module.
//
// This module is used by the help renderer only. It is NOT a general-purpose
// UI library.
// ---------------------------------------------------------------------------

import { colors, isColorSupported, stripAnsi } from "./colors.js";

/**
 * Render a text block inside a single-line ASCII border. The border is dimmed
 * when color is supported, plain otherwise. Multi-line input is preserved.
 *
 * Width is computed from the longest line (including content). Lines shorter
 * than the width are right-padded with spaces.
 */
export function box(input: string, opts?: { title?: string }): string {
  const lines = input.split("\n");
  const innerWidth = Math.max(
    ...lines.map((l) => visibleLength(l)),
    opts?.title ? visibleLength(opts.title) + 2 : 0,
  );
  const horizontal = "─".repeat(innerWidth + 2);
  const top = opts?.title
    ? `┌─ ${opts.title} ${"─".repeat(Math.max(0, innerWidth - visibleLength(opts.title) - 2))}┐`
    : `┌${horizontal}┐`;
  const bottom = `└${horizontal}┘`;

  const middle = lines.map((line) => {
    const pad = " ".repeat(Math.max(0, innerWidth - visibleLength(line)));
    return `│ ${line}${pad} │`;
  });

  const framed = [top, ...middle, bottom];
  if (isColorSupported()) {
    return framed.map((row) => (row === top || row === bottom ? colors.dim(row) : row)).join("\n");
  }
  return framed.join("\n");
}

/**
 * Visible length of a string. Strips ANSI escape sequences (delegating to the
 * shared stripAnsi) before counting so color-wrapped strings don't break box
 * alignment.
 */
function visibleLength(s: string): number {
  return stripAnsi(s).length;
}
