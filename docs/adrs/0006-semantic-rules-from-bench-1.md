# ADR 0006 — Semantic rules added in response to bench-1 NEGATIVE outcome

- Status: Accepted
- Date: 2026-05-11
- Stage: Track R (WP-R01 through WP-R05)
- Bench evidence: `/home/alfonso/Projects/spend-tracker-bench/results/VERDICT.md`

## Context

The first controlled bench (`spend-tracker-bench`, run 2026-05-10/11) tested
whether chemag's hooks + MCP enforcement produces architecturally better
code from an AI coding agent than a prose-only architectural specification
of the same intent.

The bench ran the same 12 prompts through 4 fresh Claude Code sessions:
two with chemag installed (treatment), two with only a hand-written
`CLAUDE.md` describing the architecture in prose (control). Two blinded
Sonnet reviewer sessions, fresh per pair, scored the four resulting
codebases on boundary clarity, anti-spaghetti, extensibility, and code
quality. The pre-registered rubric and thresholds are in
`spend-tracker-bench/bench/RUBRIC.md`.

**Result: NEGATIVE.** Both blinded reviewers independently picked control
as the handover winner. Treatment scored 0.80 and 0.70 on the normalized
subjective composite; control scored 1.00 in both runs. Subjective Δ =
−0.25 in favor of control. The composite (Δ = +0.075) reads "weak yes"
mathematically, but the pre-registered rubric's explicit OR-clause —
*"treatment scores worse on subjective review than control"* — triggered
the NEGATIVE outcome.

## What the bench surfaced

Chemag's current rules check:

- **Placement:** are units in role-tagged subfolders?
- **Public surface:** do cross-compound imports go through `public.ts`?
- **Bond direction:** does the dependency direction between roles match
  the bond table?

Chemag does NOT check:

- Whether port interfaces exist between roles within a compound.
- Whether cross-compound imports resolve to interfaces vs concrete classes.
- Whether composition happens in a single catalyst vs scattered.
- Whether helper functions are duplicated.

When a treatment agent hit a bond violation in the bench, the recovery
strategy that satisfied chemag was *not* "extract a port interface and
depend on that." It was *"split the compound in two so the import becomes
cross-compound through public.ts"*. Treatment-1 went from 6 entity
compounds to 23 by this mechanism. Mechanically clean. Architecturally
the same or worse — concrete repository classes still imported by name
across compound boundaries, just now through barrel re-exports.

Meanwhile, the control agent — reading prose that said "you have
interfaces (ports) and adapters (concrete implementations)" — took it at
face value and wrote literal interface files (`store-port.ts`,
`api-port.ts` in every compound). Services depended on interfaces. UI
page components received their API as a typed prop (injectable). The
composition root wired concrete adapters to interface bindings in one
place. No hook ever fired because no hook would have caught any of this.

## Decision

Add a new category of **semantic rules** to chemag that target the
architectural properties the bench showed actually matter. The current
structural rules are kept; the semantic rules are added alongside.

Track R (see `docs/master-plan/11-track-r-rule-remediation.md`) ships
four rules in two tiers:

**Tier 1 (high confidence, ships first):**
- `CHEM-PORT-001` — A compound with concrete I/O must declare at least
  one interface.
- `CHEM-PORT-003` — Cross-compound imports of class declarations are
  warnings (depend on interfaces instead).

**Tier 2 (ships only if Tier 1 doesn't flip the bench result):**
- `CHEM-PORT-004` — Stateful adapter instantiation must happen in a
  catalyst compound.
- `CHEM-DRY-001` — A function declared in N+ non-test files suggests
  reagent extraction.

These rules are language-aware (initially TypeScript-only via the
existing `ts-morph` dependency in `@chemag/plugin-typescript`). They
require real symbol resolution, not path matching — a step-change in
chemag's analytical capability.

## Validation gate

Track R is gated on a re-run of `spend-tracker-bench`. The same 12
prompts, the same `RUBRIC.md`, fresh blinded reviewers. The gate condition
is binary: *treatment must beat control on the subjective metric by ≥0.10*.

Tracks 3, 4, 5, and 6 are blocked until Track R produces a passing gate.

## Consequences

### Positive

- Chemag's value prop becomes empirically validated (or empirically
  refuted) before any further productization. The bench is now permanent
  regression infrastructure: every rule-set change can be re-run against
  the same 12 prompts.
- The four new rules are independently shippable. Each rule can be
  individually validated, measured for false-positive rate, and promoted
  from `warning` to `error` severity on its own timeline.
- The semantic-rules layer creates an architectural seam for future rule
  authors (community rule-packs, post-WP-041): if a third party wants to
  ship an architectural-rule pack, the symbol-resolution machinery built
  in WP-R03 is the foundation.

### Negative

- The TypeScript plugin grows new dependencies on `ts-morph`'s symbol API.
  Some of this is already present (the existing `CHEM-IMPORT-*` checks
  use it), but the new rules push deeper. Analyze time grows 20–40% on
  a 50-compound workspace per current estimates.
- Python and Go plugins do not get these rules in v1 of Track R. Both
  will emit a "not implemented for this language" notice when asked to
  run a semantic rule. This is acceptable for now (the bench is TS-only)
  but creates a polyglot-parity gap that needs follow-up.
- The bench re-run is operator-time-expensive (~half a day of focused
  tmux-pane management per gate). Gate 1 and possibly Gate 2 each consume
  this. Mitigation: the bench is reproducible and can be re-run cheaply
  if operator time is the bottleneck; the protocol is in
  `spend-tracker-bench/bench/SESSION-PLAYBOOK.md`.

### Open

If Gate 2 also fails, the consequence is **reframe the value prop**.
Chemag's pitch shifts from "AI agents produce better-architected code
with chemag installed" to "chemag enforces a chosen structural convention
consistently across teams of varied seniority." That's still a real
product. Different positioning. Different pricing. Different competition
(Sonar, dependency-cruiser, ArchUnit-for-TS). Tracks 3+ would need
substantial revision; the cloud dashboard becomes a convention-compliance
dashboard, not an architectural-quality dashboard.

This consequence is deferred to a separate ADR if Gate 2 fails.

## Alternatives considered

### Alternative A — ship Tracks 3+ now, fix rules later

Rejected. The bench result is the strongest signal we have about chemag's
value prop. Investing in cloud / marketplace / GTM on top of an
unvalidated wedge product compounds risk. The cost of one work-week of
rule work pales next to the cost of shipping cloud infrastructure for
a value prop that doesn't survive a public benchmark.

### Alternative B — abandon enforcement, position chemag as a generator

Rejected (for now — kept as the fallback if Gate 2 fails). The enforcement
hypothesis hasn't been disproven yet; only the *current rule set's*
enforcement has. We don't know if semantic-rule enforcement also fails
until we test it. Doing the work to find out is cheaper than abandoning
prematurely.

### Alternative C — community-author the new rules via the rule-pack SDK (WP-041)

Rejected for v1 of Track R. WP-041 isn't shipped, and the rules the bench
showed are missing are fundamental, not domain-specific. They belong in
the engine. Future *additional* semantic rules (e.g., PCI-specific
boundary checks) are good rule-pack candidates after WP-041 ships.

## Implementation reference

See `docs/master-plan/11-track-r-rule-remediation.md` for the work-package
breakdown, sequencing, and acceptance criteria. See
`/home/alfonso/Projects/spend-tracker-bench/bench/proposed-rules.md` for
the design discussion that led to this ADR.
