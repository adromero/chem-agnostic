# Cross-Cutting Concerns

These rules apply to every WP. The conductor must enforce them on every commit.

## Code style

### TypeScript

- Strict mode on. `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- No `any`. Use `unknown` and narrow.
- No barrel files except where a public API requires re-export (e.g., `packages/core/src/index.ts`).
- Default to ESM. CJS only where a consumer requires it (older Node tooling).
- Functions named with verbs, types named with nouns.
- Imports sorted: node builtins → external → workspace → relative. Biome enforces.
- File length soft cap 500 lines. Tests excluded.

### Python (plugin-python only)

- Python 3.10+ syntax (existing requirement).
- `from __future__ import annotations` at top of every file.
- Type-checked with pyright strict on the `plugin-python` package's helper script directory.

### Go (plugin-go helper only)

- Go 1.22+.
- gofmt-clean.
- `go vet` and `golangci-lint` (default config) enforced in CI.

### Comments

- No comments unless explaining *why*. CLAUDE.md rule applies repo-wide.
- Public API gets short JSDoc / docstrings only when the type signature isn't self-explanatory.
- Rationale comments cite RFC numbers or WP IDs when relevant.

## Testing strategy

### Test types

| Type | Where | Runner | Coverage target |
|---|---|---|---|
| Unit | Each package's `test/` | Vitest | ≥85% engine, ≥70% UI |
| Integration | `test/integration/` | Vitest + supertest (cloud-api) | ≥75% |
| E2E | `e2e/` (top-level) | Playwright (web), shell scripts (CLI) | Smoke + critical paths |
| Snapshot | Within unit tests | Vitest | Used for CLI output, generated docs |
| Property-based | Engine code only | fast-check | Bond rules, vocabulary, manifest checks |
| Contract | MCP server | MCP test suite | Tool & resource contracts |
| Accessibility | Web UI | axe-core via Playwright | WCAG 2.1 AA |
| Performance | Benchmark harness | tinybench | Tracked over time, regressions block merge |
| Security | Whole repo | npm audit + osv-scanner + gitleaks | No high/critical CVEs |

### Test naming

- Test files: `<source>.test.ts` next to source in `test/` folder.
- Test names: `it("<verb> <expected behavior> when <condition>")`. Avoid "should."
- Snapshots: stored in `__snapshots__/`. Reviewed in PRs.

### Continuous integration

`.github/workflows/ci.yml` runs on every PR:

1. Setup Node 22, pnpm 9, Python 3.12, Go 1.22.
2. `pnpm install --frozen-lockfile`.
3. `pnpm turbo lint typecheck test build`.
4. `pnpm test:e2e` (Playwright + CLI shell tests).
5. Upload coverage to Codecov.
6. Run `osv-scanner` on lockfile; fail on high/critical.
7. Run `gitleaks` on diff; fail on detection.
8. Run benchmark on a smaller fixture (5 prompts, 1 agent) and post comparison comment.

`benchmark-nightly.yml` runs full benchmark suite on `main` nightly, archives results, regenerates leaderboard.

`release.yml` triggered by Changesets; publishes to npm/pypi/VS Marketplace and creates GitHub releases.

`cloud-deploy.yml` deploys cloud-api to Fly.io and cloud-web to Vercel on merge to `main`. Requires manual approval for prod deploys.

## Security baseline

These controls ship in v1.0. WP-040 is the explicit SOC 2 readiness WP, but the controls below are enforced from WP-001.

### Secrets management

- No secrets in repo. `.env.example` files only.
- Cloudflare Workers secrets / Fly secrets / Vercel env for production.
- Local development uses `.env.local` (gitignored).
- gitleaks runs in CI on every diff.

### Authentication & authorization

- Clerk for user auth and org management (WP-029).
- All cloud-api endpoints require auth except `/health`, `/version`, public marketplace listing (`GET /api/packs`).
- RBAC: `owner | admin | member | viewer` per org. Enforced in middleware (WP-038).
- Service-to-service auth: signed JWTs with short TTLs (60s for synchronous, 5min for batch).

### Data handling

- All Postgres data encrypted at rest (RDS-style; Fly Postgres provides this).
- TLS 1.3 minimum on every public endpoint.
- PII columns tagged in Drizzle schema (custom annotation), exported to data classification doc.
- Customer-source code is **never** stored in our cloud. Violations are stored as `{file_path, line_range, rule_id, hint}` — no source content. Documented in privacy policy.
- Customer-source SHAs and metadata only. No diff content.
- Telemetry events include no source content, no file paths beyond compound names. WP-006 enforces.

### Dependency hygiene

- Renovate bot runs weekly; auto-merges patch updates with passing CI.
- npm audit / osv-scanner blocks PRs on new high/critical advisories.
- Lockfile-only updates allowed for security patches.
- We do not vendor third-party code.

### Audit logs

- Every cloud-api mutation writes to `audit_log` (WP-039).
- Retained 1 year. Exportable on request.
- Append-only. PRD-level table no DELETE permissions.

### Incident response

- Sentry alerts → PagerDuty → Slack #incidents.
- Status page (status.chemag.cloud) updated within 15 minutes of confirmed incident.
- Postmortems posted publicly within 5 business days for any user-impacting incident.

## Privacy

- Privacy policy lives at chemag.dev/privacy. Generated from `apps/marketing/src/content/privacy.mdx`.
- Telemetry is *opt-in*. The CLI prompts on first run after WP-006:
  > "Send anonymous usage telemetry to help improve chem-ag? [y/N]"
- A user can revoke at any time via `chemag config set telemetry.enabled false`.
- Telemetry payload schema documented in `docs-site/content/docs/telemetry.md`.
- We never sell data. The privacy policy commits to this.
- Right to erasure: `DELETE /api/me` deletes a user's data within 30 days, propagates to all services.

## Telemetry events

If consent is granted, the CLI sends:

| Event | Properties |
|---|---|
| `cli.command.invoked` | `command`, `version`, `os`, `node_version`, `language` (workspace lang), `wall_time_ms`, `success` |
| `cli.violations.found` | `count`, `check_kinds[]` (no file paths) |
| `cli.error` | `code`, `wall_time_ms` (no message; messages may contain PII) |
| `mcp.tool.called` | `tool_name`, `wall_time_ms` |
| `cli.first_run` | `language`, `vocabulary` (chemistry vs standard) |

Cloud product telemetry is governed by Clerk + PostHog in-product, scoped to logged-in user behavior on chemag.cloud only. No customer source ever leaves the customer's environment.

## Branding & vocabulary

WP-002 implements a vocabulary system. All user-facing strings (errors, help text, generated docs, marketing copy) go through `tr(key)`.

- Default vocabulary: `standard` (hexagonal terminology).
- Alternate: `chemistry`. Honors the `--vocabulary` CLI flag, `CHEMAG_VOCABULARY` env var, and `vocabulary` field in `workspace.yaml`.
- The chemistry vocabulary is preserved in YAML schema and in code internals. Only the surface is configurable.
- Marketing copy at chemag.dev defaults to standard vocabulary. A toggle on the homepage lets visitors switch.

## Observability (cloud)

- **Logs:** Pino → Logflare. JSON-structured, trace IDs throughout.
- **Metrics:** OpenTelemetry → Grafana Cloud (free tier). RED + USE dashboards.
- **Traces:** OpenTelemetry → Grafana Tempo. Service-to-service spans on every API call.
- **Errors:** Sentry. Linked to user IDs (with consent) and trace IDs.
- **Synthetic checks:** Checkly hits 5 critical paths every 5 minutes from 3 regions.

## Documentation discipline

- Every public CLI command, MCP tool, MCP resource, REST endpoint, and config field has a docs entry.
- `tools/codegen-cli-docs.ts` generates `apps/docs-site/src/content/docs/cli-reference/*.md` from CLI option definitions. Runs in CI; missing entries fail the build.
- Same pattern for MCP tools (`tools/codegen-mcp-docs.ts`) and REST routes (`tools/codegen-rest-docs.ts`).
- ADRs (Architecture Decision Records) for every significant technical decision. Format: `docs/adrs/NNNN-title.md`. WP-007 establishes the template.

## Accessibility

- All interactive web components ship WCAG 2.1 AA compliant.
- Playwright tests run axe-core on every page. Fail on violations.
- All form fields have labels. All buttons have accessible names. Color contrast ≥ 4.5:1 for body text.
- Marketing and docs sites pass Lighthouse Accessibility ≥ 95.

## Internationalization

v1.0 ships English-only across all surfaces. The vocabulary system (WP-002) is structurally similar to i18n and the same machinery extends to true i18n in v1.1. No machine translation in v1.0 — translations are professional, on-demand.

## Performance budgets

| Surface | Budget |
|---|---|
| `chemag check` on reference monorepo (200 files) | <1.5s cold, <300ms cached |
| `chemag check-edit` single file | <100ms |
| `chemag analyze` on reference monorepo | <3s cold, <600ms cached |
| `chemag mcp` startup | <500ms |
| MCP `validate_edit` call | <150ms |
| Cloud API median latency | <200ms |
| Cloud API p99 latency | <800ms |
| chemag.dev LCP (Largest Contentful Paint) | <2.0s |
| chemag.cloud authenticated dashboard FCP | <1.5s |
| docs.chemag.dev page load | <1.5s |

CI fails the relevant test/perf check on regressions >20%.

## Release cadence

- v1.0.0 launches with all 60 WPs complete.
- Post-launch: minor releases monthly (Changesets), patch releases as needed.
- Security patches within 24 hours of CVE disclosure.
- Major version bumps require RFC + 30-day deprecation window.

## Communication

- All decisions large enough to need an ADR get one.
- All breaking changes get a Changeset entry.
- All public API surface changes get a docs update in the same PR.
- Discord #releases channel auto-posts release notes.
