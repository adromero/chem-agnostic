# Operator Prerequisites

The conductor cannot create accounts, register domains, or sign payment agreements. The operator (the human user) must provision these before downstream WPs can ship. Each prerequisite gates one or more WPs as noted.

## Order of operations

The operator should provision these in this order. Items marked **(can defer)** are not needed until the corresponding WP is in flight.

### Required before WP-001

- [ ] **GitHub org `chemag-org`** — created at github.com. GitHub Pro tier (free for OSS).
- [ ] **npm org `chemag`** — created at npmjs.com. Free tier sufficient.
- [ ] **PyPI account** with permission to publish under `chemag-plugin-python`.
- [ ] **Repo permissions** — operator's GitHub user has admin on the org.

### Required before WP-018 (reference monorepo)

- [ ] **VS Code Marketplace publisher** — create publisher `chemag` at marketplace.visualstudio.com.
- [ ] **Bitbucket Pipe registry** account (only if WP-025 is in scope; otherwise defer to v1.1).

### Required before WP-028 (cloud scaffolding) **(can defer)**

- [ ] **Domain `chemag.dev`** — registered with Cloudflare or compatible DNS.
- [ ] **Domain `chemag.cloud`** — registered with Cloudflare or compatible DNS.
- [ ] **Cloudflare account** — DNS, R2, CDN, Workers (if needed).
- [ ] **Vercel account** — linked to `chemag-org` GitHub org.
- [ ] **Fly.io account** — for cloud-api deployment. Org named `chemag`.
- [ ] **Postgres** — provisioned via Fly Postgres (or external Supabase/Neon — Fly recommended).
- [ ] **Upstash Redis** — for BullMQ queue + cache.

### Required before WP-029 (auth)

- [ ] **Clerk account** — application created. OAuth providers (Email + GitHub + Google) configured. Webhook signing secret captured.

### Required before WP-030 (GitHub App)

- [ ] **GitHub App `chemag-bot`** — created under `chemag-org`. Webhook URL points to staging cloud-api initially. Permissions:
  - Repository: Contents (read), Metadata (read), Pull requests (write), Checks (write), Issues (write).
  - Subscribed events: Pull request, Push, Installation, Installation repositories.
- [ ] **App private key** — downloaded and stored in Fly secrets as `GITHUB_APP_PRIVATE_KEY`.
- [ ] **App webhook secret** — stored in Fly secrets as `GITHUB_APP_WEBHOOK_SECRET`.

### Required before WP-034 (Slack)

- [ ] **Slack app** — created at api.slack.com/apps. OAuth scopes: chat:write, channels:read, commands.
- [ ] **App credentials** — Client ID/secret stored in cloud-api secrets.

### Required before WP-035 (PagerDuty)

- [ ] **PagerDuty account** with App Integration created. (Optional for launch — can defer to v1.0.x patch.)

### Required before WP-037 (Stripe)

- [ ] **Stripe account (US entity preferred)** — for ACH payouts and Tax.
- [ ] **Stripe products** — Team plan ($25/seat/mo or per WP-054 outcome) created in Stripe dashboard.
- [ ] **Stripe webhooks** — endpoint configured pointing to cloud-api `/api/billing/webhook`.
- [ ] **Stripe Connect** — Express enabled (for WP-046 author payouts).

### Required before WP-040 (SOC 2)

- [ ] **External penetration test firm** engagement scheduled (operator chooses; e.g., Cobalt or HackerOne). This happens outside the code scope.
- [ ] **DPA template** drafted by counsel.
- [ ] **Privacy policy + ToS** drafted by counsel.
- [ ] **PCI/HIPAA pack claims** vetted by counsel before WP-044 ships those packs.

### Required before WP-052 (marketing) **(can defer)**

- [ ] **Resend account** — domain authenticated for chemag.dev. API key stored.
- [ ] **PostHog org** (cloud or self-hosted). Project key stored.
- [ ] **Sentry org** with `cloud-api` and `cloud-web` projects.
- [ ] **Cloudflare Stream** for video hosting (or Mux as alternative).
- [ ] **Logflare account** for log shipping.

### Required before WP-058 (Discord)

- [ ] **Discord server** created. Verified status (eventually). Bot credentials.

### Required before WP-060 (launch)

- [ ] **Twitter/X handle `@chemag_dev`** — registered.
- [ ] **Bluesky handle `@chemag.dev`** — registered.
- [ ] **LinkedIn page** — registered.
- [ ] **Hacker News moderator** courtesy email sent T-21 days.
- [ ] **Product Hunt scheduled launch** — submitted ≥7 days in advance.
- [ ] **Press kit** assets reviewed.

## Secrets handling

Once each prerequisite is provisioned, secrets are stored in:

- **Local development**: `apps/cloud-api/.env.local`, `apps/cloud-web/.env.local` (gitignored).
- **Staging**: Fly secrets (`flyctl secrets set`) for cloud-api, Vercel env for cloud-web/marketing/docs.
- **Production**: Same as staging, separate apps (`chemag-api-prod`, `chemag-api-staging`).
- **CI**: GitHub Actions secrets at the org level for shared keys, repo level for repo-specific.

## Verification

`scripts/check-prereqs.ts` (created in WP-001) reads `.env.example` and validates that every required key is populated in the local `.env`. CI uses this for staging/prod env validation. The script does NOT block WPs that don't depend on cloud secrets.

## Cost estimate (monthly, pre-launch)

| Service | Tier | Estimated $/mo |
|---|---|---|
| Cloudflare | Pro + R2 | $25 |
| Vercel | Pro (1 seat) | $20 |
| Fly.io | shared-cpu apps + 2GB Postgres | $40 |
| Upstash Redis | Pay-as-you-go | $10 |
| Clerk | Free tier | $0 |
| PostHog | Free tier | $0 |
| Sentry | Team | $26 |
| Resend | Free tier | $0 |
| Stripe | Free + transaction fees | $0 |
| Logflare | Hobby | $5 |
| Algolia DocSearch | Free for OSS | $0 |
| Domain registrations | $10/year ÷ 12 ≈ | $1 |
| **Total** | | **~$130/mo** |

Post-launch costs scale with usage; budget $500–$1,500/mo for the first 6 months.
