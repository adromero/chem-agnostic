// ---------------------------------------------------------------------------
// `explainCode(code)` — formats a DIAGNOSTIC_CODES entry for human display.
// Used by `chemag check --explain CHEM-XXX-NNN`. Returns null when the code
// is unknown so the caller can produce a CLI-flavoured error message.
// ---------------------------------------------------------------------------

import { DIAGNOSTIC_CODES, type DiagnosticCode, type DiagnosticCodeMeta } from "./codes.js";

/** Base URL for the published diagnostics index. */
export const DOC_BASE_URL = "https://chemag.dev/cli-reference/diagnostics";

/**
 * Format a single diagnostic-code entry for `--explain` output.
 *
 * Returns null when the code is not in the registry; callers should treat
 * this as a user-facing error.
 */
export function explainCode(code: string): string | null {
  const meta = (DIAGNOSTIC_CODES as Record<string, DiagnosticCodeMeta>)[code];
  if (!meta) return null;

  return formatExplainBlock(meta);
}

/**
 * Format the explain block for a registered code. Exported for tests and the
 * docs generator; CLI callers should prefer `explainCode` (which guards the
 * lookup).
 */
export function formatExplainBlock(meta: DiagnosticCodeMeta): string {
  const lines: string[] = [];
  lines.push(`Code:     ${meta.code}`);
  lines.push(`Level:    ${meta.level}`);
  lines.push(`Category: ${meta.category}`);
  lines.push(`TrKey:    ${meta.trKey}`);
  lines.push(`Docs:     ${docLinkFor(meta)}`);

  if (meta.deprecated) {
    const repl = meta.deprecated.replacement ? ` (replaced by ${meta.deprecated.replacement})` : "";
    lines.push(`Status:   deprecated since ${meta.deprecated.since}${repl}`);
  }

  return lines.join("\n");
}

/** Build the canonical doc URL for a diagnostic code. */
export function docLinkFor(meta: DiagnosticCodeMeta): string {
  return `${DOC_BASE_URL}#${meta.helpFragment}`;
}

/** Convenience: same as `getDiagnosticCodeMeta` with the `DiagnosticCode` cast. */
export function knownCode(code: string): code is DiagnosticCode {
  return Object.prototype.hasOwnProperty.call(DIAGNOSTIC_CODES, code);
}
