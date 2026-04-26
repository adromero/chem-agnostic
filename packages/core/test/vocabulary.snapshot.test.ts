// Snapshot/coverage test — every TrKey must exist in every shipped locale.
// Adding a new key to keys.ts without translating it in both JSON files is a
// CI failure.

import { describe, it, expect } from "vitest";
import { ALL_TR_KEYS } from "../src/vocabulary/keys.js";
import standardLocale from "../src/vocabulary/standard.json" with { type: "json" };
import chemistryLocale from "../src/vocabulary/chemistry.json" with { type: "json" };

const locales: Record<string, Record<string, string>> = {
  standard: standardLocale as Record<string, string>,
  chemistry: chemistryLocale as Record<string, string>,
};

describe("vocabulary snapshot — every TrKey exists in every locale", () => {
  for (const [localeName, locale] of Object.entries(locales)) {
    describe(`locale: ${localeName}`, () => {
      for (const key of ALL_TR_KEYS) {
        it(`has key "${key}"`, () => {
          const value = locale[key];
          expect(value, `locale ${localeName} is missing key "${key}"`).toBeTypeOf("string");
          expect(value, `locale ${localeName} key "${key}" is empty`).not.toBe("");
        });
      }
    });
  }
});

describe("vocabulary snapshot — no extra keys (every locale entry is a known TrKey)", () => {
  const known = new Set<string>(ALL_TR_KEYS);

  for (const [localeName, locale] of Object.entries(locales)) {
    it(`locale ${localeName} has no orphan keys`, () => {
      const orphans = Object.keys(locale).filter((k) => !known.has(k));
      expect(orphans, `Orphan keys in ${localeName}: ${orphans.join(", ")}`).toEqual([]);
    });
  }
});
