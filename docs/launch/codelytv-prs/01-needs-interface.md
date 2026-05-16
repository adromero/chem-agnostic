# PR 1 — Port `needs-interface` rule

## Title

`feat(rules): add needs-interface rule`

## Body

This PR adds a new rule, `needs-interface`, which flags a compound that
declares concrete adapters and reactions but no interface. The intent is
to catch the early phase of a leaking port — when an adapter folder
exists and is used by orchestration code, but the port itself hasn't
been factored out yet.

The rule operates per-file: it fires on the lexicographically-first
adapter file in any compound that matches the condition, so the message
surfaces once per compound regardless of adapter count.

### Files added

- `lib/rules/needs-interface.js` — rule implementation, ported from
  `packages/eslint-plugin/src/rules/needs-interface.ts` in
  https://github.com/adromero/chem-agnostic
- `tests/lib/rules/needs-interface.js` — fixture-driven tests
- `docs/rules/needs-interface.md` — rule docs

### Files modified

- `lib/index.js` — register the rule
- `README.md` — add the rule to the rules table

### Source of truth

- Rule: `packages/eslint-plugin/src/rules/needs-interface.ts`
- Tests: `packages/eslint-plugin/test/rules/needs-interface.test.ts`
- Fixtures:
  `packages/core/test/fixtures/semantic-rules/port-001/`

## Notes for the maintainers

- The path-classification helper
  (`packages/eslint-plugin/src/utils/path-classification.ts`) is
  re-usable across all three rules — consider lifting it into a shared
  util location in your codebase if you accept all three PRs.
- The rule has one option, `compoundsRoot`, which is the absolute path
  to the directory containing compound subdirectories. Defaults work
  for a layout where compounds live at `src/compounds/<name>/{role}/`.
- The rule is deliberately simplified relative to the original chemag
  check — it does NOT scan adapter imports for I/O modules, only the
  folder topology. See the rule header comment for rationale.
