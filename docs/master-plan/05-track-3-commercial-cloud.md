# Track 3 — Commercial Cloud (WP-028 through WP-040)

The commercial center. chemag.cloud aggregates violations across PRs and repos, posts to Slack/PagerDuty, exports for compliance, and bills for usage.

## Sequencing within track

```
WP-028 (architecture) ─→ WP-029 (auth) ─→ WP-030 (GitHub App) ─→ WP-031 (ingestion API)
                                                                   ↓
                                                              WP-032 (storage) ─→ WP-033 (dashboard UI)
                                                                                     ↓
WP-034 (Slack) ─┐                                                                    │
WP-035 (PagerDuty) ─┼─ all parallel after WP-033 ─┐                                 │
WP-036 (compliance) ─┘                              ├─→ WP-037 (Stripe) ─→ WP-038 (RBAC) ─→ WP-039 (audit) ─→ WP-040 (SOC 2)
```

WP-028 is a sprint of decisions + scaffolding. WPs 029–033 form the critical path. The rest can run in parallel teams.

---

## WP-028 — Cloud architecture and scaffolding

**Track:** 3
**Effort:** M
**Depends on:** WP-001
**Blocks:** all subsequent Track 3 WPs

### Description

Stand up `apps/cloud-api/` and `apps/cloud-web/` with the chosen stack. Establish data model conventions, deploy pipelines, observability, env management.

### Files to create

#### Cloud API (`apps/cloud-api/`)

- `package.json`, `tsconfig.json`
- `src/server.ts` — Fastify entry with health + version endpoints.
- `src/db/schema.ts` — Drizzle schema (initial: orgs, users, repos).
- `src/db/client.ts`
- `src/config.ts` — env loader (zod-validated).
- `src/lib/logger.ts` — Pino with request correlation.
- `src/middleware/error-handler.ts`
- `src/middleware/request-id.ts`
- `src/middleware/auth.ts` (placeholder; populated in WP-029)
- `Dockerfile`
- `fly.toml`
- `migrations/0001_init.sql`

#### Cloud Web (`apps/cloud-web/`)

- `package.json`, `next.config.mjs`, `tailwind.config.ts`
- `app/layout.tsx`, `app/page.tsx` (placeholder)
- `app/(auth)/sign-in/page.tsx`
- `lib/api-client.ts`
- `lib/analytics.ts` (PostHog)
- `components/ui/*` — shadcn/ui base components installed.

#### Shared

- `packages/cloud-contracts/` — zod schemas shared between API and web.
- `infra/terraform/` — base modules: Fly Postgres + R2 bucket + DNS records.
- `.github/workflows/cloud-deploy.yml` (with manual approval gate).
- `docs/adrs/0010-cloud-stack.md`

### Decisions captured

| Decision | Choice |
|---|---|
| Frontend | Next.js 14 App Router on Vercel |
| Backend | Fastify + Drizzle + Postgres 16 on Fly.io |
| Object storage | Cloudflare R2 |
| Cache + queue | Upstash Redis + BullMQ |
| Auth | Clerk (initial); switchable to NextAuth in v1.1 |
| Email | Resend |
| Observability | Sentry + Logflare + Grafana Cloud |
| Telemetry | PostHog |
| Stripe | Checkout (hosted), webhooks for state |
| CDN | Cloudflare |
| Region | us-east-1 (Vercel) + sjc (Fly) — single region for v1.0 |
| API style | REST + JSON; OpenAPI generated from zod (using `zod-to-openapi`) |

### Tests

- Healthcheck endpoint passes.
- Drizzle migrations run in CI.
- Deploy pipeline dry-run succeeds (no production write).
- Sentry capture works locally with a test DSN.

### Acceptance criteria

- [ ] `apps/cloud-api` and `apps/cloud-web` deployable to staging from `main`.
- [ ] `chemag.cloud/health` returns 200 from staging.
- [ ] OpenAPI spec generated and published to `apps/cloud-api/openapi.json`.
- [ ] All env vars documented in `.env.example` and `apps/cloud-api/README.md`.

---

## WP-029 — Auth + multi-org

**Track:** 3
**Effort:** L
**Depends on:** WP-028
**Blocks:** WP-030+

### Description

Clerk integration for user auth and orgs. Users can be members of multiple orgs. Sign-up/sign-in flows work via email + GitHub + Google providers.

### Files to create

- `apps/cloud-web/middleware.ts` (Clerk auth middleware)
- `apps/cloud-web/app/(auth)/sign-in/[[...sign-in]]/page.tsx`
- `apps/cloud-web/app/(auth)/sign-up/[[...sign-up]]/page.tsx`
- `apps/cloud-web/app/(dashboard)/orgs/select/page.tsx`
- `apps/cloud-api/src/middleware/auth.ts` — verifies Clerk JWT and binds `request.user`.
- `apps/cloud-api/src/lib/clerk.ts`
- `apps/cloud-api/src/routes/auth.ts` — webhook receiver for Clerk events.
- `apps/cloud-api/src/db/schema.ts` — extends with `users`, `orgs`, `org_members`.

### DB schema (extension)

```sql
-- Already present from WP-028: organizations, users
CREATE TABLE org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
CREATE INDEX idx_org_members_user ON org_members(user_id);
```

### Webhooks

Clerk → cloud-api: handle user.created, user.updated, user.deleted, organization.created, organizationMembership.created/deleted.

### Free trial

- New orgs get a 14-day free trial of the team tier.
- Trial state stored on `orgs` table: `{ trial_ends_at, billing_status }`.

### Tests

- Sign-up creates user + default personal org.
- Webhook dedup via Clerk event IDs.
- Auth middleware rejects bad tokens.
- Org selection persists in cookie.

### Acceptance criteria

- [ ] User can sign up and land on /select-org.
- [ ] User can create or be invited to an org.
- [ ] All API endpoints reject unauthenticated requests with 401.
- [ ] Cypress/Playwright auth E2E green.

---

## WP-030 — GitHub App

**Track:** 3
**Effort:** L
**Depends on:** WP-029
**Blocks:** WP-031

### Description

A GitHub App (`chemag-bot`) that orgs install on their repos, granting webhook access for PRs and pushes, plus PR comment write permission.

### Files to create

- `apps/cloud-api/src/routes/github-app.ts` — install callback, uninstall, webhook receiver.
- `apps/cloud-api/src/lib/github.ts` — Octokit factory using app credentials.
- `apps/cloud-api/src/jobs/github-webhook.ts` — handler for `pull_request`, `push`, `installation`.
- `apps/cloud-web/app/(dashboard)/repos/install/page.tsx` — kicks off the GitHub App install flow.
- `apps/cloud-web/app/(dashboard)/repos/page.tsx` — list of installed repos with status.
- DB migration adding `installations`, `repos` tables.

### Schema additions

```sql
CREATE TABLE installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  github_installation_id BIGINT NOT NULL UNIQUE,
  github_account_login TEXT NOT NULL,
  github_account_type TEXT NOT NULL CHECK (github_account_type IN ('User','Organization')),
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uninstalled_at TIMESTAMPTZ
);

CREATE TABLE repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id UUID NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  github_repo_id BIGINT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  default_branch TEXT,
  private BOOLEAN NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  workspace_path TEXT NOT NULL DEFAULT 'workspace.yaml',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_repos_installation ON repos(installation_id);
```

### Webhook handling

- Verify GitHub signature via `@octokit/webhooks`.
- Push events: enqueue job to compute violations on the head SHA.
- Pull request events: enqueue job to run analyze on changed files; post sticky comment.
- Installation events: create/update `installations` and `repos` rows.

### Tests

- Webhook signature verified.
- Replay attack rejected (event ID dedup).
- Org-to-installation link prevents cross-org data leakage.

### Acceptance criteria

- [ ] GitHub App created on github.com/chemag-org.
- [ ] Install flow works end-to-end: org selects repos, app appears in cloud-web.
- [ ] Push triggers a synthetic violations record.
- [ ] PR comment posted on a fixture PR.

---

## WP-031 — Violations ingestion API

**Track:** 3
**Effort:** L
**Depends on:** WP-030
**Blocks:** WP-032

### Description

The endpoint cloud customers call (directly or via the GitHub Action) to submit violations for storage and aggregation. Also receives webhook-triggered analyses from chemag-bot.

### Files to create

- `apps/cloud-api/src/routes/runs.ts` — `POST /api/runs`, `GET /api/runs/:id`.
- `apps/cloud-api/src/routes/violations.ts` — `GET /api/orgs/:orgId/violations` with filters.
- `apps/cloud-api/src/jobs/analyze-repo.ts` — BullMQ job: clone shallow, run chemag, store result.
- `apps/cloud-api/src/lib/repo-clone.ts` — sparse-checkout helper using GitHub App tokens.
- DB migrations for `runs`, `violations`, `compounds_snapshot`.

### Schema

```sql
CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('push','pull_request','manual','scheduled')),
  ref TEXT NOT NULL,
  sha TEXT NOT NULL,
  pr_number INT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_runs_repo ON runs(repo_id, created_at DESC);

CREATE TABLE violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  rule_code TEXT NOT NULL,
  level TEXT NOT NULL,
  compound TEXT,
  unit TEXT,
  file_path TEXT,
  line_start INT,
  line_end INT,
  message TEXT NOT NULL,
  hint TEXT,
  remediation_kind TEXT,
  remediation JSONB,
  fingerprint TEXT NOT NULL  -- sha256(rule_code|file|line_start|message), used for dedup across runs
);
CREATE INDEX idx_violations_run ON violations(run_id);
CREATE INDEX idx_violations_fingerprint ON violations(fingerprint);

CREATE TABLE compounds_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  units_count INT NOT NULL,
  exports JSONB,
  imports JSONB
);
```

### API endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/runs` | Submit a run from CI (auth: workspace-scoped token) |
| GET | `/api/runs/:id` | Fetch a run with violations |
| GET | `/api/orgs/:orgId/violations` | Filter by repo, rule, level, since |
| GET | `/api/orgs/:orgId/repos/:repoId/runs` | List recent runs |
| POST | `/api/orgs/:orgId/repos/:repoId/runs/manual` | Trigger a manual run |

### Privacy

- We store no source code. Source is fetched ephemerally during analysis (sparse checkout, deleted after).
- File paths and line numbers stored. Module names stored. No code content.

### Tests

- Submit a synthetic run; assert violations stored, deduped by fingerprint.
- Webhook-triggered run completes against the reference monorepo within 30s.
- Auth: cross-org access denied.

### Acceptance criteria

- [ ] A push to an installed repo creates a `run` row with violations.
- [ ] Cross-org isolation passes a fuzz test.
- [ ] No source code persisted (verified by code review checklist + grep on schema).
- [ ] OpenAPI updated.

---

## WP-032 — Aggregation, drift, history

**Track:** 3
**Effort:** L
**Depends on:** WP-031
**Blocks:** WP-033

### Description

Materialized views and rollup jobs that turn raw violations into trend data for the dashboard.

### Files to create

- `apps/cloud-api/src/jobs/nightly-rollup.ts` — populates `daily_violation_stats`.
- `apps/cloud-api/src/jobs/drift-detector.ts` — flags violations that have persisted across N runs.
- DB migrations for materialized views.
- `apps/cloud-api/src/routes/stats.ts` — endpoints for the dashboard charts.

### Schema additions

```sql
CREATE TABLE daily_violation_stats (
  date DATE NOT NULL,
  repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  rule_code TEXT NOT NULL,
  level TEXT NOT NULL,
  count INT NOT NULL,
  PRIMARY KEY (date, repo_id, rule_code, level)
);

CREATE TABLE persistent_violations (
  fingerprint TEXT PRIMARY KEY,
  repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  runs_seen INT NOT NULL,
  resolved_at TIMESTAMPTZ,
  rule_code TEXT NOT NULL,
  message TEXT NOT NULL,
  file_path TEXT
);
```

### Tests

- Nightly rollup is idempotent.
- Drift detector marks violations seen in 3+ runs as persistent.
- Resolution: violation absent in latest run sets `resolved_at`.

### Acceptance criteria

- [ ] Charts API returns 30-day trend within 200ms.
- [ ] Drift detection produces correct results on synthetic histories.

---

## WP-033 — Dashboard UI

**Track:** 3
**Effort:** XL
**Depends on:** WP-029, WP-032
**Blocks:** WP-034..WP-036, WP-037

### Description

The chemag.cloud dashboard. Org overview, repo list, violation drilldowns, drift charts, settings.

### Pages

- `/` (org overview): repo cards with violation counts, recent runs, charts.
- `/repos`: full list, search, filter.
- `/repos/[id]`: repo detail. Violations tab, runs tab, settings tab.
- `/violations`: cross-org violation explorer (filter by rule, level, repo, file).
- `/drift`: persistent violations dashboard.
- `/packs`: installed rule packs (from WP-046).
- `/settings/org`: org name, members, billing link.
- `/settings/integrations`: Slack, PagerDuty, GitHub.
- `/settings/api-keys`: generate workspace tokens for CI.
- `/billing`: Stripe portal link, usage, invoices.

### Components

- Built with shadcn/ui + Tailwind.
- Charts: Recharts for line/bar; D3 for graph viewer.
- Mermaid renderer (read-only) for compound graph view.
- Virtualized table for violations (react-virtuoso).

### Real-time updates

- Server-Sent Events on `/repos/[id]` for live run updates.
- Optimistic UI on settings changes.

### Tests

- Playwright E2E for each major flow.
- axe-core accessibility on every page.
- Visual regression via Chromatic for key pages.

### Acceptance criteria

- [ ] All listed pages functional.
- [ ] Lighthouse Performance ≥85, Accessibility ≥95.
- [ ] FCP <1.5s, TTI <3.5s.
- [ ] Cross-browser (Chrome, Firefox, Safari) verified in Playwright.

---

## WP-034 — Slack integration

**Track:** 3
**Effort:** M
**Depends on:** WP-031, WP-033
**Blocks:** none

### Description

A Slack app that orgs install. Posts violation summaries to chosen channels on a per-repo basis. Slash commands: `/chemag check <repo>`, `/chemag violations <repo>`.

### Files to create

- Slack app manifest in `infra/slack/manifest.json`.
- `apps/cloud-api/src/routes/slack.ts` — install, oauth callback, slash command handler, interactive components.
- `apps/cloud-api/src/lib/slack.ts`
- `apps/cloud-api/src/jobs/slack-notify.ts` — BullMQ job posting messages.
- `apps/cloud-web/app/(dashboard)/settings/integrations/slack/page.tsx` — install link, channel mapping.

### Notification rules (configurable per repo)

- New errors on main → channel A.
- Persistent (drift) violations → channel B (digest, daily 9am org tz).
- Run failures → channel C.

### Tests

- Mock Slack API; verify message format.
- Channel resolution per rule.
- Rate-limit handling (Slack 1 msg/sec/channel).

### Acceptance criteria

- [ ] Slack app installable.
- [ ] Notifications posted within 30s of violation creation.
- [ ] Slash commands work.
- [ ] Documented.

---

## WP-035 — PagerDuty integration

**Track:** 3
**Effort:** S
**Depends on:** WP-031, WP-033
**Blocks:** none

### Description

PagerDuty Events API integration for critical (configurable) violations. Used by orgs with strict architectural SLAs.

### Files to create

- `apps/cloud-api/src/routes/pagerduty.ts`
- `apps/cloud-api/src/lib/pagerduty.ts`
- `apps/cloud-api/src/jobs/pagerduty-notify.ts`

### Acceptance criteria

- [ ] Configurable severity mapping.
- [ ] Resolves PD incidents when violations resolve.
- [ ] Documented.

---

## WP-036 — Compliance export (PDF / Notion)

**Track:** 3
**Effort:** M
**Depends on:** WP-031, WP-032, WP-033
**Blocks:** none

### Description

For audited orgs (SOC 2, ISO 27001, HIPAA): generate a monthly architecture compliance report. PDF output (via Puppeteer-rendered HTML) and Notion sync (via Notion API).

### Files to create

- `apps/cloud-api/src/routes/exports.ts`
- `apps/cloud-api/src/lib/pdf.ts`
- `apps/cloud-api/src/lib/notion.ts`
- `apps/cloud-api/src/jobs/monthly-report.ts`
- HTML template `apps/cloud-api/src/templates/compliance-report.html.ts`.

### Report contents

- Title, period, repos in scope.
- Summary stats: total violations, resolved, persistent.
- Per-rule breakdown.
- Drift: oldest unresolved violations.
- Architecture inventory: compounds, units, public surfaces.
- Auditor-friendly footer with SHA of input runs and timestamps.

### Acceptance criteria

- [ ] PDF generation <30s for typical org.
- [ ] Notion sync to a configured database.
- [ ] Report includes verifiable SHAs.
- [ ] Branded with chemag.cloud logo.

---

## WP-037 — Stripe billing

**Track:** 3
**Effort:** L
**Depends on:** WP-029, WP-033
**Blocks:** WP-038, WP-046

### Description

Stripe Checkout for new subscriptions, Customer Portal for management, webhook-driven state machine.

### Files to create

- `apps/cloud-api/src/routes/billing.ts`
- `apps/cloud-api/src/lib/stripe.ts`
- `apps/cloud-api/src/jobs/stripe-webhook.ts`
- `apps/cloud-web/app/(dashboard)/billing/page.tsx`
- DB migrations for `subscriptions`, `usage_records`.

### Schema

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES orgs(id) ON DELETE CASCADE,
  stripe_customer_id TEXT UNIQUE NOT NULL,
  stripe_subscription_id TEXT UNIQUE,
  plan TEXT NOT NULL CHECK (plan IN ('free','team','enterprise')),
  seats INT NOT NULL DEFAULT 1,
  current_period_end TIMESTAMPTZ,
  status TEXT NOT NULL,
  cancel_at TIMESTAMPTZ
);

CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('runs','violations','seats','pack_installs')),
  quantity INT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_org_metric ON usage_records(org_id, metric, recorded_at DESC);
```

### Plans

- **Free**: 1 repo, ≤500 runs/month, no Slack/PagerDuty, no compliance export, community packs only.
- **Team** ($25/seat/month, billed monthly or annual at 20% discount): unlimited repos, unlimited runs, Slack + PagerDuty, paid packs, compliance export.
- **Enterprise** (custom): SSO, SCIM, audit log export, on-prem option (v1.1), custom packs, SLA.

### Webhooks handled

- `customer.subscription.created/updated/deleted`
- `invoice.payment_succeeded/failed`
- `checkout.session.completed`

### Tests

- Stripe webhook signature verified.
- Plan downgrade enforces feature limits at request time.
- Trial → paid conversion path.
- Past-due → restricted access (read-only).

### Acceptance criteria

- [ ] User can complete a Team subscription via Checkout.
- [ ] Customer Portal accessible.
- [ ] Past-due state restricts mutations but preserves data.
- [ ] Stripe metadata correlates `customer_id` to `org_id`.

---

## WP-038 — RBAC

**Track:** 3
**Effort:** M
**Depends on:** WP-029, WP-037
**Blocks:** none

### Description

Role-based access control across cloud-api endpoints. Roles: `owner | admin | member | viewer`.

### Files to create

- `apps/cloud-api/src/middleware/rbac.ts` — role-required decorator.
- Role-by-endpoint mapping in `apps/cloud-api/src/lib/permissions.ts`.

### Permissions matrix

| Action | owner | admin | member | viewer |
|---|---|---|---|---|
| View repos/violations/runs | ✓ | ✓ | ✓ | ✓ |
| Trigger manual run | ✓ | ✓ | ✓ | ✗ |
| Edit repo settings | ✓ | ✓ | ✗ | ✗ |
| Install/uninstall integrations | ✓ | ✓ | ✗ | ✗ |
| Manage members | ✓ | ✓ | ✗ | ✗ |
| Change billing plan | ✓ | ✗ | ✗ | ✗ |
| Delete org | ✓ | ✗ | ✗ | ✗ |
| Install rule packs | ✓ | ✓ | ✗ | ✗ |

### Tests

- Each role tested against representative endpoints (yes-path and no-path).

### Acceptance criteria

- [ ] All routes have explicit role requirements.
- [ ] Frontend hides UI for unpermitted actions (defense in depth).
- [ ] Test suite enumerates all role × endpoint combinations.

---

## WP-039 — Audit logs

**Track:** 3
**Effort:** M
**Depends on:** WP-038
**Blocks:** WP-040

### Description

Append-only audit log of every cloud-api mutation. Visible in dashboard for owners/admins. Exportable as CSV/JSON. Required for SOC 2.

### Files to create

- `apps/cloud-api/src/middleware/audit-log.ts` — wraps mutating handlers.
- `apps/cloud-api/src/routes/audit.ts` — list + filter + export.
- `apps/cloud-web/app/(dashboard)/settings/audit/page.tsx`
- DB migration for `audit_log`.

### Schema

```sql
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  actor_user_id UUID,
  actor_token_id UUID,
  ip TEXT,
  user_agent TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  diff JSONB,           -- { before, after } for diffs
  metadata JSONB
);
CREATE INDEX idx_audit_org_time ON audit_log(org_id, occurred_at DESC);
```

### Retention

- 1 year default.
- Enterprise: 7 years (S3 cold storage).

### Tests

- Mutation produces an audit record.
- No PII leaks in `diff` (passwords, tokens redacted).
- DELETE forbidden by DB role (only `audit_writer` role can INSERT).

### Acceptance criteria

- [ ] All mutations produce audit entries.
- [ ] Owners can browse and export.
- [ ] DB role enforces append-only.

---

## WP-040 — SOC 2 readiness checklist

**Track:** 3
**Effort:** M
**Depends on:** WP-039
**Blocks:** Enterprise GTM

### Description

Not a code WP per se — a closed-loop checklist that confirms each control is implemented and produces audit-time evidence. Output: `docs/compliance/soc2-readiness.md` and `tools/soc2-audit.ts` that emits a JSON evidence pack.

### Controls covered (Trust Services Criteria, Common + Security + Availability)

- Access control: Clerk SSO, RBAC (WP-038), MFA enforced for owners.
- Encryption: TLS 1.3, Postgres at-rest encryption, R2 SSE.
- Logging: audit_log (WP-039), application logs to Logflare 1-year retention.
- Backup: Fly Postgres daily backups, R2 versioning enabled.
- Incident response: Sentry → PagerDuty → status page.
- Vulnerability management: Renovate, osv-scanner, gitleaks, dependabot.
- Change management: PRs require review, CI gates, deploy approvals.
- Vendor management: list of subprocessors at chemag.dev/subprocessors.
- Data privacy: privacy policy, DPA on request, no source code stored.

### Files to create

- `docs/compliance/soc2-readiness.md`
- `docs/compliance/data-classification.md`
- `docs/compliance/incident-response.md`
- `docs/compliance/subprocessors.md` (rendered to chemag.dev)
- `apps/marketing/src/pages/security.astro`
- `apps/marketing/src/pages/subprocessors.astro`
- `tools/soc2-audit.ts` — generates an evidence JSON for an auditor.

### Acceptance criteria

- [ ] Readiness checklist produces an evidence JSON.
- [ ] Public security page live.
- [ ] DPA template available on request.
- [ ] We are SOC 2 Type 1 audit-ready (engagement with auditor scheduled, not in-scope to complete in v1.0).
