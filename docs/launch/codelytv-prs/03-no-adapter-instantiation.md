# PR 3 — Port `no-adapter-instantiation` rule

## Title

`feat(rules): add no-adapter-instantiation rule`

## Body

This PR adds `no-adapter-instantiation`, which flags `new SomeAdapter()`
in any file that is not a catalyst (composition root). The intent is to
keep wiring concentrated in one place and force reactions/adapters to
depend on interfaces.

### Bench-derived extension

The original chemag rule false-positively fired on 7-8 `new
SomeApiError(...)` call sites in our bench (errors are adapter-style
classes by file location but are throwable values, not stateful
collaborators). This port adds an opt: `allowErrorSubclasses` (default
`true`). When enabled, classes whose `extends` clause transitively
resolves to the built-in `Error` are exempt. Opt out with
`allowErrorSubclasses: false` to recover the strict behaviour.

### Files added

- `lib/rules/no-adapter-instantiation.js`
- `tests/lib/rules/no-adapter-instantiation.js`
- `docs/rules/no-adapter-instantiation.md`

### Files modified

- `lib/index.js`
- `README.md`

### Source of truth

- Rule:
  `packages/eslint-plugin/src/rules/no-adapter-instantiation.ts`
- Tests:
  `packages/eslint-plugin/test/rules/no-adapter-instantiation.test.ts`
- Fixtures:
  `packages/core/test/fixtures/semantic-rules/port-004/`
  (including the new `valid/error-subclass/` fixture that exercises
  the transitive `extends Error` walk)

## Notes for the maintainers

- Options:
  - `compoundsRoot` (required).
  - `classAllowlist` (optional) — extends the default allowlist
    (`Date`, `URL`, `Money`, `RegExp`).
  - `allowErrorSubclasses` (optional, default `true`).
  - `transientAnnotation` (optional, default `"@chemag-transient"`) —
    a comment immediately above a class declaration exempts that
    specific class. The default token can be renamed for your project
    or removed if you don't want the escape hatch.
  - `catalystCompounds` (optional) — compound names treated as the
    wiring layer. In chemag this was a manifest attribute
    (`compound.type === "catalyst"`); since path-based classification
    alone can't infer it, we expose it as an opt.
- The rule does NOT exempt same-compound `new` (in chemag the rule
  fires whether the adapter and reaction live in the same compound or
  not — the test is "is the call site in a catalyst?", not "is the
  callee in a different compound?").
