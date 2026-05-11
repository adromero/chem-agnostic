# Track R — Rule Remediation (WP-R01 through WP-R05)

These work packages add **semantic rules** to chemag's `check` and `analyze`
in direct response to the NEGATIVE outcome of `spend-tracker-bench` (run
2026-05-10/11). The full bench result lives at
`/home/alfonso/Projects/spend-tracker-bench/results/VERDICT.md` and ADR-0006
captures the architectural decision behind this track.

In one sentence: today's chemag rules are *structural* (where files live,
what they re-export, what role can depend on what); the bench showed those
rules don't capture *architectural quality* (port interfaces, dependency
inversion, single composition root, helper reuse). Treatment agents in the
bench satisfied chemag's structural rules by splitting compounds rather
than extracting interfaces — mechanically clean, architecturally worse than
the prose-only control arm.

**Track R blocks resumption of Tracks 3, 4, 5, and 6** until the bench
result flips (treatment beats control on subjective by ≥0.10).

## Sequencing

```
WP-R01 (fixtures)
   │
   ├──→ WP-R02 (PORT-001) ──→ WP-R03 (PORT-003) ──→ ▼ Gate 1: bench re-run
   │                                                ├─ pass → resume Track 3
   │                                                └─ fail ▼
   │                                                       │
   │                                                       ▼
   └──→ WP-R04 (PORT-004) ─→ WP-R05 (DRY-001) ─→ ▼ Gate 2: bench re-run
                                                  ├─ pass → resume Track 3
                                                  └─ fail → reframe value prop (see ADR-0006 §6)
```

The gates are decision points, not WPs. Each is one bench re-run (~half a
day of operator time, see `spend-tracker-bench/bench/SESSION-PLAYBOOK.md`).
The "fail" branch out of Gate 2 means semantic rules alone aren't enough
and the chemag value prop needs to be reframed; the master plan does NOT
resume in that case until a separate decision is made.

---

## WP-R01 — Test-fixture scaffolding for semantic rules

**Track:** R
**Effort:** S
**Depends on:** WP-007 (diagnostic code registry)
**Blocks:** WP-R02 through WP-R05

### Description

Build the reusable test infrastructure for the four semantic rules. Each
rule has its own fixtures dir with `valid/` and `invalid/` sub-fixtures;
every fixture is a tiny self-contained chemag workspace. A shared test
helper reads a fixture dir, runs `chemag check` or `chemag analyze` against
it, and asserts the expected diagnostic codes fire (or don't).

### Files to create

- `packages/core/test/fixtures/semantic-rules/README.md` — convention doc
  (one paragraph: how fixtures are laid out, how the helper resolves them).
- `packages/core/test/helpers/run-fixture.ts` — exports `runFixture(path)`
  that loads `workspace.yaml` from the fixture, runs check + analyze in
  memory, returns `{ checkDiagnostics, analyzeDiagnostics }`.
- `packages/core/test/helpers/assert-diagnostics.ts` — exports
  `assertDiagnosticCodes(diagnostics, expected: { codes: string[], minCount?, maxCount? })`
  for declarative assertions in rule tests.

### Files to modify

- `vitest.shared.ts` — add alias if needed for new test helpers (likely
  no change required, since `packages/core/test/**` already resolves).

### Tests

- `packages/core/test/helpers/run-fixture.test.ts` — exercises the helper
  against a baseline fixture that produces a known CHEM-MANIFEST-001
  diagnostic.
- `packages/core/test/helpers/assert-diagnostics.test.ts` — covers exact /
  minCount / maxCount cases.

### Acceptance criteria

- [ ] `runFixture(path)` returns deterministic diagnostics for a given
      fixture (no test-order coupling, no global state).
- [ ] `assertDiagnosticCodes` produces useful failure messages (lists
      expected vs actual codes, with diagnostic line/file context).
- [ ] All existing chemag tests still pass.

---

## WP-R02 — CHEM-PORT-001: compound with concrete I/O must declare an interface

**Track:** R
**Effort:** S
**Depends on:** WP-R01
**Blocks:** WP-R03

### Description

Add a manifest-level check that fires when a compound declares at least one
reaction unit AND at least one I/O-using adapter unit, but no interface
unit. "I/O-using" is detected by scanning the adapter file's imports for
known I/O modules (`better-sqlite3`, `pg`, `node:fs`, `node:http`,
`fetch`, `axios`, `undici`, `mysql2`, `mongodb`, `redis`, etc. — configurable).

The rule's purpose is to make the missing-port pattern from spend-tracker-bench
impossible to ship cleanly: the agent either extracts a port interface, or
gets a persistent warning.

### Files to create

- `packages/core/src/checks/port-needs-interface.ts` — the check function.
  Receives the loaded workspace; returns Diagnostic[]. Exports a
  configurable allowlist `IO_MODULE_PATTERNS: RegExp[]` (default set listed
  above; user can extend via `workspace.yaml` under `rules.io_modules`).
- `packages/core/test/fixtures/semantic-rules/port-001/valid/has-port/` —
  vendors compound with handlers (reaction), store (adapter, imports
  better-sqlite3), store-port (interface).
- `packages/core/test/fixtures/semantic-rules/port-001/valid/no-orchestration/` —
  compound with only adapters, no reactions.
- `packages/core/test/fixtures/semantic-rules/port-001/valid/no-io/` —
  compound with reaction + adapter that imports no I/O modules (pure data
  mapping), no interface.
- `packages/core/test/fixtures/semantic-rules/port-001/invalid/missing-port/` —
  vendors compound with handlers + store (imports better-sqlite3), no
  store-port. Expected to fire CHEM-PORT-001.
- `packages/core/test/fixtures/semantic-rules/port-001/invalid/missing-port-multi-io/` —
  two I/O adapters, one reaction, no interface. Should fire ONE diagnostic
  per compound (not per adapter).
- `packages/core/test/checks/port-needs-interface.test.ts` — vitest covering
  the four fixtures plus a unit test for the allowlist override.

### Files to modify

- `packages/core/src/checks.ts` — wire `portNeedsInterface` into the
  check pipeline (alongside existing manifest/filesystem checks).
- `packages/core/src/diagnostics/codes.ts` — add `"PORT"` to
  `DiagnosticCategory` union; add `"CHEM-PORT-001"` to `DiagnosticCode`
  union AND to the `DIAGNOSTIC_CODES` registry with a stable `trKey`
  (e.g., `"diagnostic.port.needs_interface"`).
- `packages/core/src/vocabulary/keys.ts` — register the new TrKey.
- `packages/core/src/diagnostics/explain.ts` — add the `--explain CHEM-PORT-001`
  body (definition, example, fix guidance).
- `packages/core/src/types.ts` — if Diagnostic typing exposes the category
  union directly, add `"PORT"` there too.

### Tests

In addition to the fixtures above:
- Diagnostic code registry test still passes (the registry-test enforces
  the bijection between codes and trKeys — see `codes.ts` comments).
- `chemag check --explain CHEM-PORT-001` prints the new entry.

### Acceptance criteria

- [ ] CHEM-PORT-001 fires on the `invalid/missing-port` fixture and not on
      any `valid/*` fixture.
- [ ] One diagnostic per compound, not per file.
- [ ] `workspace.yaml`'s `rules.io_modules` (optional array of regex
      strings) extends the default I/O-module allowlist.
- [ ] `chemag check --explain CHEM-PORT-001` returns a complete
      explanation.
- [ ] No regressions in existing chemag test suites.

---

## WP-R03 — CHEM-PORT-003: cross-compound imports of class declarations

**Track:** R
**Effort:** M
**Depends on:** WP-R02
**Blocks:** Gate 1 (Tier-1 bench re-run)

### Description

Add an analyze-level check that fires when a TypeScript file in compound A
imports a symbol from compound B's public surface, and that symbol resolves
(through any number of barrel re-exports) to a `class` declaration. The
fix is to depend on an interface (which the catalyst then binds to the
class).

This is the rule that most directly disabuses agents of the "I'll just
re-export the concrete class through public.ts" workaround that bench
treatment agents used.

### Files to create

- `packages/plugin-typescript/src/import-checks/port-class-import.ts` —
  the check. Uses ts-morph's symbol API: for each cross-compound
  ImportDeclaration, call `getSymbol()` → walk the export chain (handle
  `ExportDeclaration` and `ExportSpecifier`) → look at the final
  declaration's `Kind` (`ClassDeclaration` vs `InterfaceDeclaration` vs
  `FunctionDeclaration` vs `TypeAliasDeclaration` vs `VariableStatement`).
- `packages/plugin-typescript/src/import-checks/port-class-import.test.ts`
  — unit tests for the symbol-resolution helper (mocked ts-morph project).
- `packages/core/test/fixtures/semantic-rules/port-003/valid/interface-import/` —
  A imports `VendorStore` (interface) from B/public.ts.
- `packages/core/test/fixtures/semantic-rules/port-003/valid/function-import/` —
  A imports `formatMoney` (function) from B/public.ts.
- `packages/core/test/fixtures/semantic-rules/port-003/valid/type-import/` —
  A imports `Vendor` (type alias) from B/public.ts.
- `packages/core/test/fixtures/semantic-rules/port-003/valid/pure-class-allowed/` —
  A imports `Money` (class) from B/public.ts, where `Money` is on the
  allowlist via `workspace.yaml` `rules.import_class_allowlist`.
- `packages/core/test/fixtures/semantic-rules/port-003/valid/test-exemption/` —
  test file in A imports `VendorRepository` (class) from B/public.ts.
- `packages/core/test/fixtures/semantic-rules/port-003/valid/reagent-exemption/` —
  A imports `Forecast` (class) from a compound whose type is `reagent`.
- `packages/core/test/fixtures/semantic-rules/port-003/valid/transitive-reexport/` —
  A imports `VendorStore` (interface), B re-exports it from C.
- `packages/core/test/fixtures/semantic-rules/port-003/invalid/class-import/` —
  A imports `VendorRepository` (class) from B/public.ts. Expected to fire
  CHEM-PORT-003.
- `packages/core/test/checks/port-class-import.test.ts` — vitest covering
  all fixtures.

### Files to modify

- `packages/plugin-typescript/src/index.ts` — register the new import-check
  in the plugin's check list.
- `packages/core/src/import-check.ts` — extend the import-check interface
  if needed to accept declaration-kind information from the plugin (the
  plugin already returns import edges; this rule needs the *declaration
  kind* of the imported symbol, so the edge metadata may need extending).
- `packages/core/src/types.ts` — extend `ImportEdge` (or equivalent) with
  `declarationKind: "class" | "interface" | "type" | "function" | "value"`.
- `packages/core/src/diagnostics/codes.ts` — add `"CHEM-PORT-003"`. Note:
  no CHEM-PORT-002 yet — that's deferred Tier 3 per `proposed-rules.md`;
  002 stays reserved.
- `packages/core/src/vocabulary/keys.ts` — register `"diagnostic.port.class_cross_compound"`.
- `packages/core/src/diagnostics/explain.ts` — add the explain body.
- `workspace.yaml` schema (in `packages/core/src/loader.ts` or equivalent) —
  accept `rules.import_class_allowlist: string[]` (default `["Date", "URL", "Money", "RegExp"]`).

### Tests

- All fixtures above pass.
- The symbol resolver correctly follows `export { X } from "./other"`
  chains up to a configurable depth (default 5; beyond that, treat as
  unresolved and skip the check rather than false-positive).
- Test files (`**/*.test.ts`, `**/tests/**`) are exempt.
- Existing analyze tests still green.

### Acceptance criteria

- [ ] CHEM-PORT-003 fires on `invalid/class-import` and not on any `valid/*`.
- [ ] Transitive re-exports resolve correctly (the chain follows through
      barrel files).
- [ ] `rules.import_class_allowlist` exempts specified class names.
- [ ] Test files are exempt by default.
- [ ] Reagent-compound exports are exempt by default.
- [ ] Performance: analyze on a 50-compound workspace runs in <5s
      (the symbol resolution shouldn't be N²).
- [ ] `chemag check --explain CHEM-PORT-003` returns a complete entry.

---

## Gate 1 — Tier-1 bench re-run

**Not a WP.** A decision point after WP-R03 ships.

### Protocol

1. From `spend-tracker-bench/`, delete the `runs/` directory entirely
   (`rm -rf runs/`).
2. Verify `chemag --version` reports the new build with R02 + R03 present.
3. Re-run the 4 tmux panes per `bench/SESSION-PLAYBOOK.md`. Same 12
   prompts. Same model. No edits to `bench/PROMPTS.md`, `bench/RUBRIC.md`,
   `bench/CONTROL-CLAUDE.md`, or any other locked artifact.
4. Spawn TWO NEW blinded Sonnet reviewer sessions for the two pairs.
   Do NOT reuse the prior reviews; the X/Y assignment is randomized per
   pair fresh.
5. Compute composite per `bench/RUBRIC.md`. Append run-2 results to
   `spend-tracker-bench/results/` with a `-run2` suffix to preserve
   run-1.
6. Apply the gate condition:

| Condition | Decision |
|---|---|
| Mean(treatment subjective) ≥ Mean(control subjective) + 0.10 | **PASS** — Track R complete. Resume master plan at Track 3 (or the operator-preferred track). |
| Tied or treatment ahead by < 0.10 | **PARTIAL** — proceed to WP-R04 + WP-R05. |
| Treatment still behind on subjective | **FAIL of Tier 1** — proceed to WP-R04 + WP-R05; if Tier 2 also fails, reframe per ADR-0006. |

The gate result is recorded in
`spend-tracker-bench/results/GATE-1.md` regardless of outcome (pass or fail),
with the composite delta, the subjective delta, and the reviewer notes.

---

## WP-R04 — CHEM-PORT-004: stateful adapter instantiation must happen in a catalyst

**Track:** R
**Effort:** M
**Depends on:** WP-R03 (reuses constructor-resolution machinery), Gate 1 (only ships if Gate 1 didn't fully pass)
**Blocks:** Gate 2

### Description

Add an analyze-level check that fires when a `new XAdapter()` expression
appears in a file outside the catalyst compound, where the constructor's
declaration is in a file with role `adapter`. The fix is to move the
instantiation into the catalyst and pass the resulting instance to the
caller (via injection through interface).

### Files to create

- `packages/plugin-typescript/src/import-checks/adapter-instantiation.ts` —
  AST scan for `NewExpression` nodes; resolve constructor to declaration
  file; check role + caller compound.
- `packages/plugin-typescript/src/import-checks/adapter-instantiation.test.ts` — unit tests.
- `packages/core/test/fixtures/semantic-rules/port-004/valid/catalyst-wires/` —
  `new VendorRepo()` in `src/catalyst/api-server.ts`.
- `packages/core/test/fixtures/semantic-rules/port-004/valid/test-wires/` —
  `new VendorRepo()` in `vendors/handlers.test.ts`. Test files exempt.
- `packages/core/test/fixtures/semantic-rules/port-004/valid/transient-tagged/` —
  `new HttpClient()` in `vendors/handlers.ts`, where `HttpClient` declaration
  is preceded by a `// @chemag-transient` annotation.
- `packages/core/test/fixtures/semantic-rules/port-004/invalid/handler-wires/` —
  `new VendorRepo()` in `vendors/handlers.ts`. Expected to fire CHEM-PORT-004.

### Files to modify

- `packages/plugin-typescript/src/index.ts` — register the new check.
- `packages/core/src/diagnostics/codes.ts` — add `"CHEM-PORT-004"`.
- `packages/core/src/vocabulary/keys.ts` — register the trKey.
- `packages/core/src/diagnostics/explain.ts` — add the explain body.
- Compound-type schema (in `loader.ts`) — accept an optional `transient`
  marker comment recognized by the plugin (no schema change, just a
  parser convention).

### Tests

- All fixtures pass.
- The `// @chemag-transient` annotation is honored.
- Test files are exempt.

### Acceptance criteria

- [ ] CHEM-PORT-004 fires on `invalid/handler-wires` and not on `valid/*`.
- [ ] Tests exempt by default.
- [ ] Allowlist class names from CHEM-PORT-003 also exempt here (a class
      on the import allowlist is also on the instantiation allowlist).
- [ ] `chemag check --explain CHEM-PORT-004` returns a complete entry.

---

## WP-R05 — CHEM-DRY-001: function duplicated across N+ files

**Track:** R
**Effort:** S
**Depends on:** WP-R04 (only ships if Gate 1 didn't fully pass)
**Blocks:** Gate 2

### Description

Add a suggestion-level (not warning-level, not error-level) diagnostic that
fires when a function declaration with the same name appears in N+
non-test files across the workspace. N is configurable, default 3. The
fix is to extract the helper to a reagent compound.

Suggestion-level means the diagnostic is emitted by `chemag analyze` but
does NOT fail CI or block edits. The VS Code extension and MCP server
surface suggestions as hints. CLI shows them only with
`chemag check --suggestions` or `chemag analyze --suggestions`.

### Files to create

- `packages/plugin-typescript/src/import-checks/duplicated-function.ts` —
  AST scan, function-name index by name across files, threshold check.
- `packages/plugin-typescript/src/import-checks/duplicated-function.test.ts`.
- `packages/core/test/fixtures/semantic-rules/dry-001/invalid/duplicated/` —
  `fieldErrorsFromZod` declared in 4 separate handler files.
- `packages/core/test/fixtures/semantic-rules/dry-001/valid/unique/` —
  every function in one file.
- `packages/core/test/fixtures/semantic-rules/dry-001/valid/below-threshold/` —
  `validate` in 2 files (threshold=3 by default).
- `packages/core/test/fixtures/semantic-rules/dry-001/valid/tests-excluded/` —
  `setup` in 5 `*.test.ts` files.

### Files to modify

- `packages/plugin-typescript/src/index.ts` — register the new check.
- `packages/core/src/diagnostics/codes.ts` — add `"DRY"` category and
  `"CHEM-DRY-001"`.
- `packages/core/src/vocabulary/keys.ts` — trKey.
- `packages/core/src/diagnostics/explain.ts` — explain body.
- `packages/core/src/types.ts` — if Diagnostic severity union is `"error"
  | "warning"`, extend to `"error" | "warning" | "suggestion"`.
- `packages/cli/src/commands/check.ts` and `packages/cli/src/commands/analyze.ts`
  — add `--suggestions` flag (default off; suggestions only appear when set).
- `packages/cli/src/cli-meta.ts` — register the `--suggestions` flag in
  the meta registry.
- `workspace.yaml` schema — accept `rules.duplicate_function_threshold: number`
  (default 3) and `rules.duplicate_function_exclude: string[]` (default
  `["setup", "teardown", "beforeEach", "afterEach"]`).

### Tests

- All fixtures pass.
- Suggestions hidden by default in CLI output.
- `--suggestions` flag surfaces them.

### Acceptance criteria

- [ ] CHEM-DRY-001 fires on `invalid/duplicated` and not on `valid/*`.
- [ ] Threshold and exclude allowlist configurable in `workspace.yaml`.
- [ ] `chemag check --explain CHEM-DRY-001` returns a complete entry.
- [ ] CI default (no `--suggestions`) does not surface DRY-001.

---

## Gate 2 — Tier-2 bench re-run

**Not a WP.** A decision point after WP-R05 ships (only reached if Gate 1
didn't fully pass).

### Protocol

Identical to Gate 1, with one difference: the result file is
`spend-tracker-bench/results/GATE-2.md`.

### Decision

| Condition | Decision |
|---|---|
| Mean(treatment subjective) ≥ Mean(control subjective) + 0.10 | **PASS** — Track R complete. Resume master plan. |
| Treatment still tied / behind on subjective | **FAIL** — enforcement-as-mechanism is the wrong approach. Reframe per ADR-0006 §6. The master plan stays paused until a separate strategic decision is made. |

---

## Notes on scope

- **TypeScript only for v1.** The four rules ship for the TS plugin first.
  Python and Go plugins inherit the diagnostic codes but emit a "not
  implemented for this language" notice; full implementation follows in
  a later track (or as language-plugin maintainers volunteer).
- **No new dependencies.** All four rules can be implemented with
  `ts-morph` (already a TS plugin dependency) and `yaml` (already used).
- **Performance.** The TS plugin already runs symbol resolution for the
  existing `CHEM-IMPORT-*` rules. The new rules add maybe 20–40% to
  analyze time on a 50-compound workspace. Acceptable.
- **Default severity for all new rules is `warning`, not `error`.**
  After 2 weeks of dogfooding on the chem-agnostic repo itself (which
  has compounds in `packages/core/src/`), promote to error per-rule if
  the false-positive rate is acceptable.

## Track R total effort

| WP | Effort | Notes |
|---|---|---|
| R01 | S | Test infra. |
| R02 | S | PORT-001. Manifest-level, trivial. |
| R03 | M | PORT-003. Symbol resolution through barrels. The biggest piece. |
| Gate 1 | — | ~half-day of operator time. |
| R04 | M | PORT-004. Constructor → role. |
| R05 | S | DRY-001. Name index. |
| Gate 2 | — | ~half-day. |

Best case: R01+R02+R03+Gate1 = ~5 sessions of code work + 1 bench re-run = 1 work-week.

Worst case: all of the above plus R04+R05+Gate2 = ~9 sessions + 2 bench re-runs.

## Open questions for the operator

- **Should default severity be `warning` or `error`?** Recommendation:
  `warning`. The bench shows agents respond to warnings (chemag check
  output is visible to them); they don't need to be hard-blocked. And
  hard-blocking with semantic rules at v0.x risks a high false-positive
  rate.
- **Should `--explain` text be operator-authored or generated?** Today
  `--explain` is hand-written in `diagnostics/explain.ts`. Recommendation:
  hand-written, follow the existing style.
- **Should Gate 1 require BOTH composite Δ AND subjective Δ to flip, or
  just subjective?** Recommendation: just subjective. The composite is
  already largely driven by mechanical metrics that treatment wins
  trivially; subjective is the load-bearing signal.
