// ---------------------------------------------------------------------------
// Registry-test for the diagnostic-code system (wp-007).
//
// The bijection between every `diagnostic.*` TrKey and a CHEM-CATEGORY-NNN
// code is the load-bearing invariant. If a future change adds a new
// `diagnostic.*` key without registering a code (or registers a code without
// a backing key), this test fails.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import {
  DIAGNOSTIC_CODES,
  RESERVED_CODES,
  type DiagnosticCode,
  type DiagnosticCodeMeta,
} from "../src/diagnostics/codes.js";
import { explainCode } from "../src/diagnostics/explain.js";
import { ALL_TR_KEYS, type TrKey } from "../src/vocabulary/keys.js";

const DIAGNOSTIC_KEYS: TrKey[] = ALL_TR_KEYS.filter((k) => k.startsWith("diagnostic."));
const CODES: DiagnosticCode[] = Object.keys(DIAGNOSTIC_CODES) as DiagnosticCode[];
const ENTRIES: DiagnosticCodeMeta[] = Object.values(DIAGNOSTIC_CODES);

describe("DIAGNOSTIC_CODES — bijection with diagnostic.* TrKeys", () => {
  it("every diagnostic.* TrKey appears as the trKey of exactly one entry", () => {
    for (const key of DIAGNOSTIC_KEYS) {
      const matches = ENTRIES.filter((e) => e.trKey === key);
      expect(matches, `TrKey "${key}" must map to exactly one code`).toHaveLength(1);
    }
  });

  it("every entry's trKey is a member of the diagnostic.* TrKey subset", () => {
    const known = new Set<string>(DIAGNOSTIC_KEYS);
    for (const entry of ENTRIES) {
      expect(
        known.has(entry.trKey),
        `Code ${entry.code} references unknown trKey ${entry.trKey}`,
      ).toBe(true);
    }
  });

  it("at least 29 codes are registered (one per landed diagnostic.* TrKey)", () => {
    expect(CODES.length).toBeGreaterThanOrEqual(29);
  });

  it("the number of codes equals the number of diagnostic.* keys", () => {
    expect(CODES.length).toBe(DIAGNOSTIC_KEYS.length);
  });

  it("no two entries share a code", () => {
    const seen = new Set<string>();
    for (const entry of ENTRIES) {
      expect(seen.has(entry.code), `duplicate code ${entry.code}`).toBe(false);
      seen.add(entry.code);
    }
  });

  it("the registry key for each entry equals its code field", () => {
    for (const [k, v] of Object.entries(DIAGNOSTIC_CODES)) {
      expect(v.code).toBe(k);
    }
  });
});

describe("DIAGNOSTIC_CODES — numbering monotonicity", () => {
  it("each category's NNN values form a contiguous prefix WITHIN each 100-block, modulo deprecations", () => {
    const byCategory = new Map<string, DiagnosticCodeMeta[]>();
    for (const e of ENTRIES) {
      if (!byCategory.has(e.category)) byCategory.set(e.category, []);
      byCategory.get(e.category)!.push(e);
    }

    for (const [category, entries] of byCategory) {
      // Extract NNN suffix from each code (e.g. "CHEM-BOND-002" -> 2).
      const nums = entries.map((e) => {
        const m = e.code.match(/-(\d{3})$/);
        expect(m, `code ${e.code} does not end in -NNN`).not.toBeNull();
        return Number(m![1]);
      });

      // No two live entries in a category share an NNN.
      expect(new Set(nums).size, `category ${category} has duplicate NNN values`).toBe(nums.length);

      // Group by 100-block — the policy partitions codes into 001..099,
      // 101..199, 201..299, .... Each block must be contiguous starting at
      // its block-low (1, 101, 201, ...), modulo deprecations.
      const blocks = new Map<number, number[]>();
      for (const n of nums) {
        const blockLow = n < 100 ? 1 : Math.floor(n / 100) * 100 + 1;
        if (!blocks.has(blockLow)) blocks.set(blockLow, []);
        blocks.get(blockLow)!.push(n);
      }

      const deprecatedNums = entries
        .filter((e) => e.deprecated !== undefined)
        .map((e) => Number(e.code.match(/-(\d{3})$/)![1]));

      // Reserved codes for this category — codes that are planned but not yet
      // registered. Extracted from RESERVED_CODES whose CATEGORY segment
      // matches `category`. A NNN missing from `nums` is permitted when the
      // synthesized code "CHEM-<CATEGORY>-NNN" appears in RESERVED_CODES.
      const reservedNumsForCategory = new Set<number>();
      for (const reserved of RESERVED_CODES) {
        const m = reserved.match(/^CHEM-(.+)-(\d{3})$/);
        if (!m) continue;
        if (m[1] === category) reservedNumsForCategory.add(Number(m[2]));
      }

      for (const [blockLow, blockNums] of blocks) {
        const sorted = [...blockNums].sort((a, b) => a - b);
        const max = sorted[sorted.length - 1];
        for (let want = blockLow; want <= max; want++) {
          const present = sorted.includes(want);
          const isReservedDeprecation = deprecatedNums.includes(want);
          const isReservedFuture = reservedNumsForCategory.has(want);
          expect(
            present || isReservedDeprecation || isReservedFuture,
            `category ${category}: NNN ${String(want).padStart(3, "0")} is missing in block starting at ${String(
              blockLow,
            ).padStart(3, "0")} and not reserved by a deprecation or RESERVED_CODES`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("DIAGNOSTIC_CODES — snapshot of registered code keys", () => {
  it("matches the canonical sorted list (detects accidental removals)", () => {
    const sorted = [...CODES].sort();
    expect(sorted).toMatchSnapshot();
  });
});

describe("DIAGNOSTIC_CODES — deprecation flow", () => {
  // We don't ship a deprecated entry yet; this test exercises the *mechanism*
  // by stamping a temporary deprecated marker on a real entry, asserting that
  // explainCode surfaces it, then restoring the original meta.
  it("explainCode includes 'deprecated since X (replaced by Y)' when meta.deprecated is set", () => {
    const target: DiagnosticCode = "CHEM-BOND-001";
    const original = DIAGNOSTIC_CODES[target];

    const mutable = DIAGNOSTIC_CODES as Record<DiagnosticCode, DiagnosticCodeMeta>;
    mutable[target] = {
      ...original,
      deprecated: { since: "1.5.0", replacement: "CHEM-BOND-002" },
    };

    try {
      const out = explainCode(target);
      expect(out).not.toBeNull();
      expect(out).toContain("deprecated since 1.5.0");
      expect(out).toContain("replaced by CHEM-BOND-002");
      // original code still resolves
      expect(out).toContain("CHEM-BOND-001");
    } finally {
      mutable[target] = original;
    }
  });

  it("explainCode tolerates a deprecated entry without a replacement", () => {
    const target: DiagnosticCode = "CHEM-BOND-001";
    const original = DIAGNOSTIC_CODES[target];

    const mutable = DIAGNOSTIC_CODES as Record<DiagnosticCode, DiagnosticCodeMeta>;
    mutable[target] = { ...original, deprecated: { since: "2.0.0" } };

    try {
      const out = explainCode(target);
      expect(out).not.toBeNull();
      expect(out).toContain("deprecated since 2.0.0");
      expect(out).not.toContain("replaced by");
    } finally {
      mutable[target] = original;
    }
  });
});
