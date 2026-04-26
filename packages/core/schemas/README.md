# `@chemag/core` schemas

JSON Schemas published with the toolkit. Each is validated in tests via `ajv`.

## `check-edit-result.schema.json`

Output of `chemag check-edit <file> --format json`. See
`packages/core/src/check-edit.ts` for the producer and
`packages/cli/test/commands/check-edit.test.ts` for round-trip tests.

## `diagnostics.schema.json`

Output of `chemag check --format json` and `chemag analyze --format json`.
Defines the canonical workspace-level diagnostics envelope used by every
command's machine-readable JSON output (added in wp-005).

## `sarif-2.1.0.schema.json`

Vendored copy of the SARIF 2.1.0 JSON Schema, used by the SARIF emitter
test (`packages/cli/test/format/sarif.test.ts`) to validate that
`chemag * --format sarif` produces a schema-valid SARIF log.

### Provenance

- **Source:** <https://json.schemastore.org/sarif-2.1.0.json>
- **Upstream `$id`:** `https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json`
- **Vendored on:** 2026-04-26
- **Reason:** SARIF schema validation in CI must work offline and must not
  drift between runs. The schema is stable across SARIF 2.1.0 (the OASIS
  spec is locked at this version).

### Update procedure

1. `curl -L https://json.schemastore.org/sarif-2.1.0.json -o packages/core/schemas/sarif-2.1.0.schema.json`
2. Run the SARIF formatter test suite. If a producer change broke
   compatibility, fix the producer — never the vendored schema.
3. Update the "Vendored on" date above.
