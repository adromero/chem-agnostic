# PR 2 — Port `no-concrete-class-import` rule

## Title

`feat(rules): add no-concrete-class-import rule`

## Body

This PR adds `no-concrete-class-import`, which flags an `import { Foo }
from '../../other/public'` where `Foo` resolves (through any number of
barrel re-exports, capped at 5 hops) to a `class` declaration in a
different compound. The fix is to import the corresponding interface
instead.

The novel piece is the **alias chain resolution**:
`@typescript-eslint/utils` exposes the TS Program through
`parserServices.program`; the rule walks `getImmediateAliasedSymbol`
one hop at a time so a depth cap is meaningful. A chain deeper than the
cap returns `null` and the rule does NOT fire — null is treated as
"unresolvable; do not flag" to avoid noisy false positives on deep
barrel projects.

### Files added

- `lib/rules/no-concrete-class-import.js`
- `tests/lib/rules/no-concrete-class-import.js` — includes a
  programmatic 6-deep barrel-chain test for the depth cap.
- `docs/rules/no-concrete-class-import.md`

### Files modified

- `lib/index.js`
- `README.md`

### Source of truth

- Rule: `packages/eslint-plugin/src/rules/no-concrete-class-import.ts`
- Util: `packages/eslint-plugin/src/utils/symbol-resolution.ts`
- Tests: `packages/eslint-plugin/test/rules/no-concrete-class-import.test.ts`
- Fixtures:
  `packages/core/test/fixtures/semantic-rules/port-003/`

## Notes for the maintainers

- Options:
  - `compoundsRoot` (required) — same shape as PR 1.
  - `reagentRoots` (optional) — paths to "shared kernel" directories
    whose classes are intentionally allowed to cross compound
    boundaries.
  - `classAllowlist` (optional) — extends the default allowlist
    (`Date`, `URL`, `Money`, `RegExp`).
  - `consumerRoles` (optional) — roles subject to the rule (defaults
    `["adapter", "reaction", "catalyst"]`).
- The rule requires `parserServices` from `@typescript-eslint/parser`.
  This is an existing peer dep for your plugin so no new dep is added.
- The rule uses `ts.SyntaxKind.ClassDeclaration` directly (not the
  numeric constant) — that constant has changed between TS major
  versions and is the kind of bug that fails only on upgrade.
