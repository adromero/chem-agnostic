// ---------------------------------------------------------------------------
// assertDiagnosticCodes — declarative diagnostic assertions for fixture
// tests. Produces failure messages that list expected vs. actual codes
// (with multiplicity) plus per-diagnostic file:line context so test
// regressions pinpoint the offending fixture location.
// ---------------------------------------------------------------------------
import type { Diagnostic } from "../../src/types.js";

export interface ExpectedDiagnostics {
  /** Required codes. In exact-match mode the multiset must equal this list. */
  codes: string[];
  /** When set, the total diagnostic count must be >= minCount. */
  minCount?: number;
  /** When set, the total diagnostic count must be <= maxCount. */
  maxCount?: number;
}

/**
 * Assert that the given diagnostics match the expected shape.
 *
 * Two modes:
 *
 * - **Exact-match** (neither `minCount` nor `maxCount` is set): the multiset
 *   of actual `code` values must equal the multiset of `expected.codes`. Order
 *   does not matter; duplicates in `expected.codes` are honored exactly.
 * - **Bounded** (either `minCount` or `maxCount` is set): `expected.codes` is
 *   treated as a required subset — every listed code must appear at least
 *   once in the actual diagnostics, AND the total diagnostic count must
 *   satisfy `>= minCount` (if given) and `<= maxCount` (if given).
 *
 * On any mismatch, throws an `Error` whose message lists:
 *   - the expected codes (as given),
 *   - the expected min/max if supplied,
 *   - the actual codes (sorted, deduped, with multiplicity, e.g.
 *     `CHEM-MANIFEST-001 (x2), CHEM-PLACEMENT-001 (x1)`),
 *   - one indented bullet `  - <code> at <file>:<line>` per actual diagnostic
 *     that carries a `file` and/or `line`.
 */
export function assertDiagnosticCodes(
  diagnostics: Diagnostic[],
  expected: ExpectedDiagnostics,
): void {
  const isBounded = expected.minCount !== undefined || expected.maxCount !== undefined;

  const actualCodes = diagnostics.map((d) => d.code);
  const actualCounts = countBy(actualCodes);
  const expectedCounts = countBy(expected.codes);

  let ok = true;
  if (isBounded) {
    // Required-subset: every expected code must appear at least once.
    for (const code of new Set(expected.codes)) {
      if ((actualCounts.get(code) ?? 0) < 1) {
        ok = false;
        break;
      }
    }
    if (expected.minCount !== undefined && diagnostics.length < expected.minCount) ok = false;
    if (expected.maxCount !== undefined && diagnostics.length > expected.maxCount) ok = false;
  } else {
    // Exact multiset equality.
    if (actualCounts.size !== expectedCounts.size) {
      ok = false;
    } else {
      for (const [code, count] of expectedCounts) {
        if (actualCounts.get(code) !== count) {
          ok = false;
          break;
        }
      }
    }
  }

  if (ok) return;
  throw new Error(buildFailureMessage(diagnostics, expected, actualCounts));
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function countBy(codes: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of codes) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

function buildFailureMessage(
  diagnostics: Diagnostic[],
  expected: ExpectedDiagnostics,
  actualCounts: Map<string, number>,
): string {
  const lines: string[] = ["assertDiagnosticCodes mismatch"];
  lines.push(`  expected codes: [${expected.codes.join(", ")}]`);
  if (expected.minCount !== undefined) lines.push(`  expected minCount: ${expected.minCount}`);
  if (expected.maxCount !== undefined) lines.push(`  expected maxCount: ${expected.maxCount}`);

  const sortedCodes = [...actualCounts.keys()].sort();
  const actualRendered =
    sortedCodes.length === 0
      ? "(none)"
      : sortedCodes.map((c) => `${c} (x${actualCounts.get(c) ?? 0})`).join(", ");
  lines.push(`  actual codes: ${actualRendered}`);
  lines.push(`  actual total: ${diagnostics.length}`);

  const located = diagnostics.filter((d) => d.file !== undefined || d.line !== undefined);
  if (located.length > 0) {
    lines.push("  locations:");
    for (const d of located) {
      const file = d.file ?? "<unknown>";
      const line = d.line ?? "?";
      lines.push(`    - ${d.code} at ${file}:${line}`);
    }
  }

  return lines.join("\n");
}
