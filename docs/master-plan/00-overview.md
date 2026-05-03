# Master Build Plan — chem-ag → Commercial GTM Product

This directory is the authoritative implementation plan. The conductor skill consumes these files to drive multi-session execution. Every work package (WP) is fully specified — no stubs, no MVPs, no "we'll figure it out later" sections. Each WP lists files, schemas, dependencies, tests, and acceptance criteria sufficient for an executor to implement without further design work.

## Reading order

1. `00-overview.md` — this file
2. `01-repository-structure.md` — target monorepo layout
3. `02-track-0-foundations.md` — WP-001 to WP-008 (CLI hardening + telemetry)
4. `03-track-1-ai-integration.md` — WP-009 to WP-018 (hooks, MCP, emit-rules)
5. `04-track-2-cross-language-ci.md` — WP-019 to WP-027 (Go plugin, GitHub Action, VS Code)
6. `05-track-3-commercial-cloud.md` — WP-028 to WP-040 (cloud dashboard)
7. `06-track-4-marketplace.md` — WP-041 to WP-046 (rule packs)
8. `07-track-5-benchmarks.md` — WP-047 to WP-051 (benchmark harness + leaderboard)
9. `08-track-6-gtm.md` — WP-052 to WP-060 (marketing, docs, launch)
10. `09-cross-cutting.md` — testing, security, telemetry, branding, code style
11. `10-acceptance-criteria.md` — definition of done across the whole program

## Product vision

**chem-ag** ships as a polyglot architecture-guardrails product with three surfaces:

1. **Open-source CLI + plugins + MCP server** — the engine. MIT-licensed. Drives adoption.
2. **chemag.cloud** — hosted dashboard with PR ingestion, drift trends, Slack/PagerDuty alerts, compliance export, billing. The commercial center.
3. **Rule-pack marketplace** — first- and third-party architectural rule packs (PCI, HIPAA, frontend/backend, ML training/inference, etc.). Long-term moat.

The CLI is also the substrate for AI-agent integrations (Claude Code hooks, Cursor rules, Codex AGENTS.md, Aider conventions, MCP server) and CI integrations (GitHub Action, GitLab template, Bitbucket Pipes, VS Code extension).

Polyglot from day one: TypeScript, Python, Go ship in v1.0. Plugin interface stays stable for community-contributed plugins.

## Decision philosophy: experiments are instrumentation, not exits

Earlier conversation framed phases as "if experiment fails, pivot or stop." That stops short of GTM. **In this plan, every code path ships.** Experiments are *instrumentation* and *positioning intelligence*, not gates that delete features.

- Vocabulary A/B test: we ship both vocabularies in code (WP-002). The experiment decides which is *default* in marketing copy. The chemistry vocabulary is preserved.
- Self-correction benchmark: we ship the benchmark itself as a public, ongoing leaderboard (WP-050). It's a marketing asset regardless of result. If hooks improve self-correction, that's the headline. If they don't, we publish what *does* work and pivot the marketing around that finding while still shipping hooks for the cases where they matter.
- Pricing experiments: we ship three Stripe price points behind a feature flag (WP-054). The experiment determines which one stays public, but the billing infrastructure is identical across outcomes.
- Design-partner outcome: we ship the cloud product regardless. Design partners refine the priorities of dashboard features, not whether the dashboard exists.

The worst-case scenarios become *additional product surfaces*, not replacements:

| Originally framed as a pivot | Now a permanent part of v1.0 |
|---|---|
| "Pivot to security/compliance guardrails" | First-party rule packs include PCI, HIPAA, OWASP boundary rules. Architecture and compliance share the engine. |
| "Pivot to context-only MCP if hooks fail" | MCP server ships *and* hooks ship. Users opt in to either or both. |
| "Pivot to dashboard if engine doesn't sell" | Dashboard ships regardless. CLI and dashboard are sold together; CLI is the wedge, dashboard is the renewal. |
| "Bottoms-up freemium if WTP is low" | Ships as the default pricing model. Enterprise tier exists for high-WTP segments discovered in-flight. |

## Glossary

Internal terms in YAML and code keep chemistry naming. User-facing surfaces (errors, help, generated docs, marketing) honor the vocabulary setting and default to standard hexagonal vocabulary.

| Internal (YAML, code) | Standard vocab (user-facing default) | Meaning |
|---|---|---|
| compound | module | A feature unit (directory containing related code) |
| unit | file | A source file with an architectural role |
| role | role | The architectural classification of a file |
| element | value-object | Pure value type, leaf of dependency tree |
| molecule | entity | Domain state composed of value objects |
| reaction | use-case | Workflow / orchestration |
| interface | port | Contract / capability boundary |
| adapter | adapter | Concrete implementation of a port |
| buffer | middleware | Cross-cutting wrapper around use cases |
| reagent | shared-kernel | Building blocks reusable everywhere |
| solvent | infrastructure | Implicit cross-cutting (logging, config) |
| catalyst | composition-root | DI / wiring root |
| bond | dependency-rule | Allowed dependency direction between roles |
| signal | event | Async cross-module message |
| assay | test | Test file scoped to a module |
| wiring | binding | Adapter-to-port binding declaration |

## Sequencing and dependencies

The 60 work packages form a DAG. Critical path:

```
WP-001 (monorepo) ─┬─→ WP-002..WP-008 (foundations)
                    │
                    ├─→ WP-009..WP-013 (emit-rules + install-hooks)
                    ├─→ WP-014..WP-017 (MCP server)
                    ├─→ WP-019..WP-022 (multi-lang + Go plugin)
                    │
                    └─→ WP-028..WP-040 (cloud) ── parallel ──→ WP-041..WP-046 (marketplace)

WP-018 (reference monorepo) needed for WP-047..WP-051 (benchmarks)
WP-023..WP-027 (CI integrations) need WP-005 (output formats) + WP-009 (rule emission)
WP-052..WP-060 (GTM) need everything else mostly complete
```

Detailed dependency tables live in each track file under "Sequencing within track" and at the top of each WP.

## Effort and parallelism estimates

The plan assumes 1–3 executors working in parallel via the conductor. Track 0 must finish before Tracks 1–4 can run in parallel. Track 5 (benchmarks) needs the reference monorepo from Track 1. Track 6 (GTM) is the final integration phase.

Rough effort estimates per work package are noted (S/M/L/XL):
- S = ~1 session, well-scoped
- M = ~2 sessions, multiple files
- L = ~3–5 sessions, significant new surface area
- XL = ~6+ sessions, full sub-project

| Track | Total WPs | Effort sum |
|---|---|---|
| 0 — Foundations | 8 | ~12 sessions |
| 1 — AI integration | 10 | ~18 sessions |
| 2 — Cross-language + CI | 9 | ~20 sessions |
| 3 — Commercial cloud | 13 | ~35 sessions |
| 4 — Marketplace | 6 | ~12 sessions |
| 5 — Benchmarks | 5 | ~10 sessions |
| 6 — GTM | 9 | ~18 sessions |
| **Total** | **60** | **~125 sessions** |

This is a real 6-month build for a small team. The conductor should plan accordingly.

## Non-negotiables

These run through every WP:

1. **No stubs.** Every function ships fully implemented or is omitted from scope. If a feature isn't ready for shipping, it's deferred to a later WP, not stubbed.
2. **Tests required.** Every WP that adds behavior adds tests. Coverage target: ≥85% for engine code, ≥70% for cloud/marketing code. CI must enforce.
3. **Production deploy targets.** The cloud, marketing, and docs sites must be deployable to their target hosts (Vercel, Fly.io, R2) at the end of each WP that touches them. No "we'll deploy at the end."
4. **Migration safety.** Database migrations are reversible (down migrations) and tested in CI.
5. **Telemetry is opt-in.** WP-006 enforces this. No telemetry sent without explicit user consent.
6. **Backwards compatibility within v1.0.x.** Breaking CLI/MCP changes require major version bumps.
7. **Security baseline.** WP-040 specifies SOC 2 readiness; every WP touching cloud must respect the controls listed there from day one (encryption at rest, audit logs, RBAC).
8. **Accessibility.** All web UI ships WCAG 2.1 AA compliant.
9. **Documentation co-located.** Every WP that adds a public command or API also updates `docs-site/` content.

## Repository moves and renames

WP-001 converts the current single-package repo into a pnpm workspace + Turborepo monorepo. The current `src/` becomes `packages/cli/src/`, `plugins/` becomes `packages/plugins/{typescript,python}/`, and new packages slot in alongside. See `01-repository-structure.md` for the full target tree.

## What conductor should do per WP

For each WP:

1. Read the WP section in full (track file).
2. Check dependencies are complete; if not, work on those first.
3. Read referenced existing files to understand integration surface.
4. Implement all files listed under "Files to create/modify."
5. Implement all tests listed under "Tests."
6. Run the full test suite; fix anything it broke.
7. Verify acceptance criteria explicitly (the WP lists them as a checklist).
8. Commit with message `WP-NNN: <title>` and reference the WP file.
9. Mark the WP as complete in `docs/master-plan/STATUS.md` (created in WP-001).
10. Move to next WP per the sequencing table.

## What is *not* in this plan

- Multi-region cloud deploys (single region in v1.0; multi-region in v1.1).
- On-premise self-hosted enterprise install (deferred to v1.1).
- IDE extensions beyond VS Code (JetBrains in v1.1, Zed via LSP in v1.1).
- Mobile apps. There is no mobile use case for an architecture tool.
- Rust, Java, .NET plugins. v1.0 ships TypeScript, Python, Go. Others are community contributions.
- Custom DSL for rule expressions. YAML stays the rule format.
