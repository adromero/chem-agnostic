# ADR 0002 — Diagnostic-code system

- Status: Accepted
- Date: 2026-04-25
- Stage: WP-007

## Context

WP-002 landed a TrKey vocabulary with 28 distinct `diagnostic.*` keys spread across `packages/core/src/checks.ts` (25 keys, 9 check functions) and `packages/core/src/import-check.ts` (3 keys). Each key produces a localized message via `tr()`. Users and tooling, however, need a stable, terse identifier per diagnostic — not a full TrKey path — so that:

- Test suites can assert against a code without coupling to wording.
- IDEs and editor extensions can deep-link to documentation.
- CI bots can reference rule violations in PR comments by code.
- Users can run `chemag check --explain CHEM-BOND-001` to read rule docs from the terminal.
- Future deprecation of a rule can be communicated without breaking existing references.

A free-text `check` field already exists on `Diagnostic`, but it is per-check-function (15 values), not per-message (28). Several check functions emit multiple distinct diagnostics with different semantics; conflating them under a single `check` string loses information.

## Decision

We add a parallel registry of stable identifiers, keyed bijectively against the `diagnostic.*` subset of `TrKey`.

### Code shape

`CHEM-<CATEGORY>-<NNN>` where:

- `CHEM` is a constant prefix (we don't yet have multiple identifier families).
- `<CATEGORY>` is one of: `MANIFEST`, `BOND`, `IMPORT`, `EXPORT`, `WIRING`, `SIGNAL`, `ASSAY`, `TYPE`, `PUBLIC`, `ROLE`, `PLACEMENT`. New categories require an ADR addendum.
- `<NNN>` is a zero-padded ordinal, starting at `001` and incrementing by 1 within a category. Gaps are permitted **only** when a code is deprecated; new codes never reuse a deprecated number.

### Cardinality invariant

**One code per `diagnostic.*` TrKey.** The `DIAGNOSTIC_CODES` registry in `packages/core/src/diagnostics/codes.ts` is a `Record<DiagnosticCode, DiagnosticCodeMeta>` whose entries each carry a `trKey: DiagnosticTrKey` field. The registry-test (`packages/core/test/diagnostics-registry.test.ts`) walks `ALL_TR_KEYS`, filters to keys starting with `diagnostic.`, and asserts:

1. Every such key appears as the `trKey` of exactly one entry.
2. Every entry's `trKey` is a member of the diagnostic subset.
3. The total count is ≥ 28.

Adding a new `diagnostic.*` key without registering a code makes this test fail in CI; adding a code typed by an unknown trKey fails to compile (the union is closed).

### `Diagnostic.code` is required

The `Diagnostic` interface gains a required `code: DiagnosticCode` field. Every `diags.push({...})` site in `checks.ts` and `import-check.ts` was updated to include it. Existing `toMatchObject({ level, check, message, ... })` assertions in tests continue to pass because `toMatchObject` is structural-subset; per-test churn was therefore avoided.

### `--explain` flag

`cmdCheck` parses `--explain CHEM-XXX-NNN` early — before the existing `argv.find(a => !a.startsWith("-"))` workspace resolution — and short-circuits to `explainCode(code)`. This keeps the help-style query working without a workspace argument:

```
chemag check --explain CHEM-BOND-001
```

The output block contains: code, level, category, trKey, doc link, and (if applicable) deprecation note. If the code is unknown, the command exits 2 with a clear error.

### Deprecation flow

A `DiagnosticCodeMeta.deprecated?: { since: string; replacement?: DiagnosticCode }` field allows the registry to keep an old code alive while signposting a successor. `explainCode` surfaces this as a `Status: deprecated since X (replaced by Y)` line.

When deprecating a code:

1. Set `deprecated` on the entry — do **not** delete the entry.
2. Add a new entry with the next free `NNN` in the category. The deprecated `NNN` is never reused.
3. The registry-test continues to pass; the snapshot test will detect the new key and require a snapshot update.

### Documentation generator

A small Node script (`scripts/gen-diagnostics.mjs`) walks `DIAGNOSTIC_CODES` and writes a markdown index to `docs/cli-reference/diagnostics.md`. The eventual home is `apps/docs-site/src/content/docs/cli-reference/diagnostics.md` (lands in WP-053); until that workspace exists, the file lives under `docs/` with an inline note flagging the future migration.

## Alternatives considered

- **One code per check function (~15 codes).** Coarser than the `diagnostic.*` TrKey set; would make distinct diagnostics from the same function indistinguishable from outside.
- **One code per emit site (could be > 28).** Re-runs from a single trKey would produce diagnostics with identical messages but different codes — incoherent.
- **Reuse the existing `check` field as the canonical identifier.** Already overloaded for grouping in the CLI summary, and not stable across refactors.
- **Numeric-only codes (e.g. `1001`).** Loses the category prefix that helps human readers triage.

## Consequences

Positive:

- One canonical, stable identifier per emitted message.
- Compiler-enforced coverage: missing code in a `diags.push` fails to typecheck; unknown trKey fails the registry-test.
- `--explain` gives users an offline rulebook entry.
- Documentation can be auto-generated from the registry; no risk of drift between code and docs.

Negative / costs:

- Per-PR overhead when adding a new diagnostic: must update `keys.ts`, locale JSONs (already required by WP-002), and `DIAGNOSTIC_CODES`.
- Snapshot updates required when codes are added — a small but visible reviewer-facing diff.

## Follow-ups

- WP-053 migrates the diagnostics index into the docs site under `apps/docs-site/`.
- A future ADR addendum may introduce a separate identifier family (e.g. `LINT-` for source-only lints distinct from architectural diagnostics) — at that point, the `CHEM-` prefix becomes load-bearing.
