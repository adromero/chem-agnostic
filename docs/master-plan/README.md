# Master Build Plan — Index

This directory is the authoritative implementation plan for chem-ag's evolution into a commercial GTM product. The conductor skill consumes these files to drive multi-session execution.

## Files

| File | Purpose |
|---|---|
| [00-overview.md](./00-overview.md) | Vision, decision philosophy, glossary, sequencing |
| [01-repository-structure.md](./01-repository-structure.md) | Target monorepo layout, naming conventions, tooling baseline |
| [02-track-0-foundations.md](./02-track-0-foundations.md) | WP-001 → WP-008 (monorepo, vocabulary, cache, formats, telemetry) |
| [03-track-1-ai-integration.md](./03-track-1-ai-integration.md) | WP-009 → WP-018 (emit-rules, hooks, MCP, reference monorepo) |
| [04-track-2-cross-language-ci.md](./04-track-2-cross-language-ci.md) | WP-019 → WP-027 (multi-lang, Go plugin, GH Action, VS Code) |
| [05-track-3-commercial-cloud.md](./05-track-3-commercial-cloud.md) | WP-028 → WP-040 (cloud-api, dashboard, Slack, billing, SOC 2) |
| [06-track-4-marketplace.md](./06-track-4-marketplace.md) | WP-041 → WP-046 (rule packs, registry, payouts) |
| [07-track-5-benchmarks.md](./07-track-5-benchmarks.md) | WP-047 → WP-051 (prompts, harness, runners, leaderboard) |
| [08-track-6-gtm.md](./08-track-6-gtm.md) | WP-052 → WP-060 (marketing, docs, content, launch) |
| [09-cross-cutting.md](./09-cross-cutting.md) | Style, testing, security, telemetry, branding (applies to every WP) |
| [10-acceptance-criteria.md](./10-acceptance-criteria.md) | v1.0 launch checklist |
| [STATUS.md](./STATUS.md) | Live WP tracking — updated as work completes |
| [PREREQUISITES.md](./PREREQUISITES.md) | External accounts/services the operator must provision |

## How to use

1. Read [00-overview.md](./00-overview.md) end to end before starting any WP.
2. Read [01-repository-structure.md](./01-repository-structure.md) and [09-cross-cutting.md](./09-cross-cutting.md).
3. Begin with WP-001 (monorepo conversion). All other WPs depend on it.
4. After WP-001, fan out per the sequencing diagrams in each track file.
5. Each WP fully specifies files, schemas, tests, and acceptance criteria. No design improvisation needed — everything that needs to be decided is decided in the plan.
6. Mark WPs complete in [STATUS.md](./STATUS.md) as you go.
7. v1.0 ships when [10-acceptance-criteria.md](./10-acceptance-criteria.md) is fully checked.

## Total scope

- 60 work packages
- 7 tracks
- ~125 effort-sessions estimated
- ~6 months of focused work for a small team
- No stubs, MVPs, or proofs of concept — every WP ships production code

## Owner

The user (`/home/alfonso/`) commissioned this plan. The conductor skill executes it. Major decisions follow ADRs in `docs/adrs/` (created in WP-007 and onward).
