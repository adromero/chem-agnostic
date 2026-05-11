# WP Status

The conductor updates this file as work completes. Format per row: `[ ]` pending, `[~]` in progress, `[x]` complete, with completion date.

## Track 0 — Foundations

- [x] WP-001 — Monorepo conversion + project prerequisites (2026-04-25)
- [x] WP-002 — Vocabulary system (verified 2026-05-09 via codebase audit — packages/core/src/vocabulary/)
- [x] WP-003 — Manifest cache layer (verified 2026-05-09 — packages/core/src/cache/, proper-lockfile)
- [x] WP-004 — `check-edit` subcommand (verified 2026-05-09 — packages/cli/src/commands/check-edit.ts + bench)
- [x] WP-005 — Output formats: JSON, SARIF, JUnit (verified 2026-05-09 — packages/cli/src/format/)
- [x] WP-006 — Telemetry library (opt-in) (verified 2026-05-09 — packages/telemetry/, --no-telemetry honored)
- [x] WP-007 — Error code system + diagnostic taxonomy (verified 2026-05-09 — packages/core/src/diagnostics/codes.ts, --explain)
- [x] WP-008 — CLI ergonomics overhaul (verified 2026-05-09 — citty + packages/cli/src/ui/ + completion)

## Track 1 — AI-Agent Integration

- [x] WP-009 — `emit-rules` subcommand (verified 2026-05-09 — 6 emitters, idempotent markers)
- [x] WP-010 — `install-hooks` for Claude Code (verified 2026-05-09 — packages/cli/src/installers/claude-code.ts)
- [x] WP-011 — `install-hooks` for Cursor (verified 2026-05-09 — installers/cursor.ts)
- [x] WP-012 — `install-hooks` for Codex / OpenAI (verified 2026-05-09 — installers/codex.ts)
- [x] WP-013 — `install-hooks` for Aider, Cline, Copilot (verified 2026-05-09 — three installers)
- [x] WP-014 — MCP server scaffold (verified 2026-05-09 — packages/mcp-server/)
- [x] WP-015 — MCP tools (verified 2026-05-09 — 8 tools, 63+ test cases)
- [x] WP-016 — MCP resources + subscriptions (verified 2026-05-09 — 6 resources + chokidar watcher)
- [x] WP-017 — MCP registration helpers (verified 2026-05-09 — mcp-install + per-tool adapters)
- [x] WP-018 — Reference monorepo (2026-05-02; **Go service dropped for v1.0**, revisit after WP-021)

## Track 2 — Cross-Language + CI

- [x] WP-019 — Multi-language workspace schema (verified 2026-05-09 — Track 2 closed)
- [x] WP-020 — Multi-language plugin orchestration (verified 2026-05-09)
- [x] WP-021 — Go language plugin (verified 2026-05-09 — packages/plugin-go/)
- [x] WP-022 — Cross-language E2E test suite (verified 2026-05-09)
- [x] WP-023 — GitHub Action (verified 2026-05-09 — packages/github-action/)
- [x] WP-024 — GitLab CI template (verified 2026-05-09)
- [x] WP-025 — Bitbucket Pipes (verified 2026-05-09)
- [x] WP-026 — VS Code extension (2026-05-04 + 04b follow-ups WP-026b–f)
- [x] WP-027 — LSP server polish (2026-05-04 + WP-027b — promoted to standalone @chemag/lsp-server)

## Track R — Rule Remediation (blocks Tracks 3+)

Driven by NEGATIVE outcome of `spend-tracker-bench` (2026-05-11). See
[11-track-r-rule-remediation.md](./11-track-r-rule-remediation.md) and
ADR-0006.

- [ ] WP-R01 — Test-fixture scaffolding for semantic rules
- [ ] WP-R02 — CHEM-PORT-001 (compound with concrete I/O needs interface)
- [ ] WP-R03 — CHEM-PORT-003 (cross-compound class import is a warning)
- [ ] **Gate 1** — Tier-1 bench re-run; PASS unblocks Track 3
- [ ] WP-R04 — CHEM-PORT-004 (adapter instantiation only in catalyst) — ships only if Gate 1 partial/fail
- [ ] WP-R05 — CHEM-DRY-001 (duplicated function suggests reagent) — ships only if Gate 1 partial/fail
- [ ] **Gate 2** — Tier-2 bench re-run; FAIL triggers value-prop reframe (separate ADR)

## Track 3 — Commercial Cloud

> Blocked by Track R Gate 1.

- [ ] WP-028 — Cloud architecture and scaffolding
- [ ] WP-029 — Auth + multi-org
- [ ] WP-030 — GitHub App
- [ ] WP-031 — Violations ingestion API
- [ ] WP-032 — Aggregation, drift, history
- [ ] WP-033 — Dashboard UI
- [ ] WP-034 — Slack integration
- [ ] WP-035 — PagerDuty integration
- [ ] WP-036 — Compliance export (PDF / Notion)
- [ ] WP-037 — Stripe billing
- [ ] WP-038 — RBAC
- [ ] WP-039 — Audit logs
- [ ] WP-040 — SOC 2 readiness checklist

## Track 4 — Marketplace

- [ ] WP-041 — Rule-pack schema
- [ ] WP-042 — Marketplace registry API
- [ ] WP-043 — Marketplace UI
- [ ] WP-044 — First-party rule packs
- [ ] WP-045 — `chemag pack` CLI
- [ ] WP-046 — Author revenue share + Stripe Connect

## Track 5 — Benchmarks

- [ ] WP-047 — Benchmark prompt library
- [ ] WP-048 — Benchmark harness
- [ ] WP-049 — Cross-agent runners
- [ ] WP-050 — Public leaderboard
- [ ] WP-051 — Reproducibility kit + paper

## Track 6 — GTM

- [ ] WP-052 — Marketing site (chemag.dev)
- [ ] WP-053 — Docs site (docs.chemag.dev)
- [ ] WP-054 — Pricing page + WTP A/B test
- [ ] WP-055 — Waitlist + email automation
- [ ] WP-056 — Launch content (blog posts + social)
- [ ] WP-057 — PostHog feature flags + analytics
- [ ] WP-058 — Discord community + bot
- [ ] WP-059 — Demo videos + asciinema
- [ ] WP-060 — Launch playbook + week-of execution

## Launch checklist

See [10-acceptance-criteria.md](./10-acceptance-criteria.md). v1.0 ships when every item is checked.

## Scope notes

### WP-018 — Go service dropped for v1.0

The original WP-018 spec called for a third language sub-tree in
`apps/reference-monorepo/` — a Go background worker. Per the operator
decision recorded on 2026-05-01, **Go is dropped from v1.0** of the
reference monorepo because the Go language plugin (WP-021, Track 2) has not
yet shipped. The Go workload is replaced by a TypeScript Node.js worker
using `pg-boss`. The Go service will be added back as a follow-up after
WP-021 lands. This note is referenced by `apps/reference-monorepo/README.md`
under "What's missing in v1.0".
