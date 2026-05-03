# Track 4 — Rule-Pack Marketplace (WP-041 through WP-046)

The marketplace is the long-term moat. Curated architectural rule packs (PCI, HIPAA, ML training/inference separation, frontend/backend boundaries) sell at a premium and create a third-party ecosystem that's expensive to replicate.

## Sequencing within track

```
WP-041 (schema) ─→ WP-042 (registry API) ─→ WP-043 (marketplace UI) ─┐
                                                                       ├─→ WP-046 (revenue share)
WP-044 (first-party packs) ──────────────────────────────────────────┤
                                                                       │
WP-045 (chemag pack CLI) ─────────────────────────────────────────────┘
```

WP-041 + WP-042 form the API surface; everything else depends on them.

---

## WP-041 — Rule-pack schema

**Track:** 4
**Effort:** M
**Depends on:** WP-001, WP-007
**Blocks:** WP-042

### Description

Define the format of a rule pack: the manifest, the rules, the prompts, the tests. Versioned and signed.

### Files to create

- `packages/rule-pack-sdk/package.json`
- `packages/rule-pack-sdk/src/schema.ts` — zod schemas for pack manifest.
- `packages/rule-pack-sdk/src/loader.ts`
- `packages/rule-pack-sdk/src/validator.ts`
- `packages/rule-pack-sdk/src/sign.ts` — Ed25519 signing.
- `docs/master-plan/RULE_PACK_SPEC.md`

### Pack layout

```
my-pack/
├── pack.yaml              # Pack manifest
├── rules.yaml             # workspace.yaml fragment (overlay)
├── prompts.md             # AI agent guidance, appended to AGENTS.md when installed
├── tests/                 # Self-tests for the pack itself
│   ├── valid/
│   └── invalid/
├── README.md
├── LICENSE
└── pack.sig               # Ed25519 signature over deterministic hash of contents
```

### `pack.yaml` schema

```yaml
api: 1
id: "@chemag/pci-architecture"        # Globally unique
name: "PCI-DSS Architecture Boundaries"
version: "1.0.0"                      # Semver
description: "Enforces PCI-DSS architectural separation: cardholder-data zones, network segmentation, and audit-trail boundaries."
author:
  name: "chemag, Inc."
  url: "https://chemag.dev"
license: "Apache-2.0"
homepage: "https://chemag.dev/packs/pci-architecture"
repository: "https://github.com/chemag-org/pack-pci"
languages: ["typescript", "python", "go"]   # Compatible languages
chemag_min_version: "1.0.0"
tier: "free" | "paid"
price_usd_per_seat_per_month: 5            # If tier == paid
tags: ["compliance", "pci", "security"]
checksum: "sha256-..."                      # Deterministic hash of all pack files
```

### `rules.yaml` overlay semantics

A pack provides a partial workspace.yaml. On install, fields are merged:
- `roles`: union with workspace; pack roles get `"_pack": "<pack-id>"` annotation.
- `bonds`: deep-merged (pack bonds added; conflicts surface as install error unless `--force-override`).
- `compound_types`: union.
- `signals.registry`: union.
- New top-level keys (`policy_zones`, `data_classifications`) are pack-only.

### Tests for the pack itself

- `tests/valid/` — fixtures that should pass with the pack installed.
- `tests/invalid/` — fixtures that should produce specific diagnostics.
- `chemag-pack-test` runs both directions, reports.

### Tests

- Pack manifest validation.
- Overlay merge: roles, bonds, compound_types.
- Signature verification.
- Pack-level test runner produces accurate results.

### Acceptance criteria

- [ ] Spec documented in `RULE_PACK_SPEC.md`.
- [ ] Reference pack (`@chemag/example-pack`) compiled and tested.
- [ ] SDK published to npm.

---

## WP-042 — Marketplace registry API

**Track:** 4
**Effort:** L
**Depends on:** WP-028, WP-029, WP-041
**Blocks:** WP-043

### Description

The cloud-api endpoints serving the marketplace: list, search, install, version, payment.

### Files to create

- `apps/cloud-api/src/routes/packs.ts`
- `apps/cloud-api/src/routes/pack-publish.ts`
- `apps/cloud-api/src/lib/pack-registry.ts`
- `apps/cloud-api/src/jobs/pack-validate.ts` — validates uploaded packs.
- DB migration for `packs`, `pack_versions`, `pack_installs`, `pack_authors`.
- R2 layout for pack tarballs.

### Schema

```sql
CREATE TABLE pack_authors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES orgs(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  homepage TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  payout_account_id TEXT  -- Stripe Connect account
);

CREATE TABLE packs (
  id TEXT PRIMARY KEY,                  -- pack id e.g. "@chemag/pci-architecture"
  author_id UUID REFERENCES pack_authors(id),
  name TEXT NOT NULL,
  description TEXT,
  tier TEXT NOT NULL CHECK (tier IN ('free','paid')),
  price_usd_per_seat_per_month NUMERIC(10,2),
  tags TEXT[],
  homepage TEXT,
  repository TEXT,
  license TEXT,
  current_version TEXT NOT NULL,
  total_installs INT NOT NULL DEFAULT 0,
  rating_avg NUMERIC(3,2),
  rating_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated','removed'))
);

CREATE TABLE pack_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  checksum TEXT NOT NULL,
  signature TEXT NOT NULL,
  r2_key TEXT NOT NULL,                 -- pointer to tarball
  changelog TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  yanked BOOLEAN NOT NULL DEFAULT false,
  yanked_reason TEXT,
  UNIQUE (pack_id, version)
);

CREATE TABLE pack_installs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uninstalled_at TIMESTAMPTZ,
  UNIQUE (org_id, pack_id) WHERE uninstalled_at IS NULL
);

CREATE TABLE pack_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pack_id, user_id)
);
```

### Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/packs` | none | List/search packs |
| GET | `/api/packs/:id` | none | Pack details |
| GET | `/api/packs/:id/versions` | none | Version list |
| GET | `/api/packs/:id/download/:version` | optional | Download tarball (paid: requires entitlement) |
| POST | `/api/packs/publish` | author | Upload + validate new version |
| DELETE | `/api/packs/:id/versions/:v` | author | Yank a version |
| POST | `/api/orgs/:orgId/packs/:packId/install` | admin | Install on org |
| DELETE | `/api/orgs/:orgId/packs/:packId` | admin | Uninstall |
| POST | `/api/packs/:id/ratings` | member | Rate / review |

### Validation pipeline

On publish:
1. Verify signature.
2. Validate schema (zod).
3. Run pack's self-tests in a sandbox container (Fly.io machines API).
4. Static-analyze rules.yaml for known anti-patterns (e.g. impossible bonds).
5. If all pass, store tarball, create row.

### Entitlement

- Free packs: download anyone.
- Paid packs: org subscription + active install row required.
- Tarball URLs are pre-signed R2 URLs valid 5 minutes per request.

### Tests

- Publish flow with valid/invalid pack.
- Sandbox isolation (sandbox can't network out).
- Entitlement: paid pack download denied without install row.

### Acceptance criteria

- [ ] Publish a sample pack via API.
- [ ] Install an OSS pack on an org.
- [ ] Search returns relevance-ranked results.

---

## WP-043 — Marketplace UI

**Track:** 4
**Effort:** L
**Depends on:** WP-033, WP-042
**Blocks:** WP-046

### Description

Public marketplace browsing experience plus the in-dashboard install UI.

### Pages

- `chemag.dev/packs` (public, marketing-side) — browse, search, see ratings.
- `chemag.dev/packs/[id]` (public) — pack detail, README, screenshots, install button (deep-links to dashboard).
- `chemag.cloud/packs` (in-dashboard) — installed packs, available packs, install/uninstall actions.
- `chemag.cloud/packs/[id]` (in-dashboard) — pack detail with org-specific install state.
- `chemag.cloud/packs/publish` (author) — publish flow (multi-step form: upload tarball, fill metadata, preview, publish).

### Components

- Search with filters (language, tier, tags).
- Rating component (5-star + review).
- Install diff: shows what merging the pack into the org's workspace will change.

### Tests

- Playwright E2E: browse → install → see in violations.
- Rating prevents duplicate per user.
- Install diff matches actual merge result.

### Acceptance criteria

- [ ] Public marketplace SEO-indexable (server-rendered).
- [ ] Install flow works end-to-end.
- [ ] Author publish flow works.
- [ ] Lighthouse marketing score ≥85.

---

## WP-044 — First-party rule packs

**Track:** 4
**Effort:** L
**Depends on:** WP-041
**Blocks:** GTM (we need real packs at launch)

### Description

Author and ship the launch packs. These are both products and proof points for the spec.

### Packs to ship at v1.0

1. `@chemag/pci-architecture` (paid, $5/seat/mo) — Cardholder data zones, network segmentation, audit-trail boundaries.
2. `@chemag/hipaa-architecture` (paid, $5/seat/mo) — PHI boundaries, audit logging, BAA-aware separation.
3. `@chemag/owasp-boundaries` (free) — Common OWASP Top 10 architectural patterns: input validation boundaries, output encoding, authentication separation.
4. `@chemag/frontend-backend` (free) — Strict frontend/backend separation, no backend-internal imports from frontend.
5. `@chemag/ml-training-inference` (paid, $5/seat/mo) — Inference-safe vs training-target boundaries (the policy zone use case from the existing RFC).
6. `@chemag/microservices-boundaries` (free) — Per-service architectural rules in a monorepo.
7. `@chemag/event-sourcing` (free) — Event-sourcing-friendly boundaries: aggregate-event-projection.
8. `@chemag/clean-architecture` (free) — Classic Uncle-Bob clean architecture mapped to chemag roles.

### Files to create per pack

- `packages/rule-packs/<pack>/pack.yaml`
- `packages/rule-packs/<pack>/rules.yaml`
- `packages/rule-packs/<pack>/prompts.md`
- `packages/rule-packs/<pack>/tests/valid/...`
- `packages/rule-packs/<pack>/tests/invalid/...`
- `packages/rule-packs/<pack>/README.md`

### Quality bar

- Each pack passes its own tests.
- Each pack has at least 5 valid + 5 invalid test fixtures.
- Each pack documented on the marketing site (`chemag.dev/packs/<id>`).
- Paid packs: legal review of the compliance claims (we say "supports PCI alignment," not "PCI-certifies your code").

### Tests

- All packs validate via SDK.
- All pack self-tests pass in CI.
- Snapshot of installed-pack workspace overlay.

### Acceptance criteria

- [ ] 8 packs published to the marketplace at v1.0 launch.
- [ ] Each pack has ≥1 case study or example codebase demonstrating use.
- [ ] Marketing pages live for each.

---

## WP-045 — `chemag pack` CLI

**Track:** 4
**Effort:** M
**Depends on:** WP-041, WP-042
**Blocks:** WP-046

### Description

CLI surface for browsing, installing, and authoring packs locally.

### Commands

```
chemag pack search [query]                 # Search the registry
chemag pack info <id>                      # Show pack details
chemag pack install <id>[@<version>]       # Install a pack into the workspace
chemag pack uninstall <id>
chemag pack list                           # List installed packs
chemag pack update [id]                    # Update one or all packs
chemag pack publish ./path-to-pack         # Author flow: validate + publish
chemag pack init <id>                      # Scaffold a new pack
chemag pack test                           # Run pack self-tests (for authors)
chemag pack sign                           # Sign a pack with your Ed25519 key
chemag pack login                          # Authenticate with chemag.cloud for publishing
```

### Behavior

- Installs write to `.chemag/packs/<id>/` and add a reference to `workspace.yaml`:

```yaml
packs:
  - id: "@chemag/pci-architecture"
    version: "1.0.0"
    enabled: true
```

- chemag check/analyze auto-merges installed pack rules.
- Tarballs cached at `~/.cache/chemag/packs/<id>/<version>.tgz`.

### Auth

- `chemag pack login` opens browser, captures token via local server callback (port-collision-safe), stores at `~/.config/chemag/credentials`.

### Tests

- Install/uninstall round-trips.
- Update detects new versions.
- Auth flow tested with mock OAuth.
- Pack publish from CLI works end-to-end.

### Acceptance criteria

- [ ] `chemag pack install @chemag/owasp-boundaries` works on the reference monorepo.
- [ ] After install, `chemag check` includes pack rules.
- [ ] After `chemag pack uninstall`, behavior reverts.
- [ ] Documented in docs site.

---

## WP-046 — Author revenue share + Stripe Connect

**Track:** 4
**Effort:** L
**Depends on:** WP-037, WP-042, WP-043, WP-045
**Blocks:** Pack ecosystem launch

### Description

Third-party pack authors earn 70% of pack revenue. We use Stripe Connect (Express) to onboard authors and disburse payouts.

### Files to create

- `apps/cloud-api/src/routes/payouts.ts`
- `apps/cloud-api/src/lib/stripe-connect.ts`
- `apps/cloud-api/src/jobs/monthly-payout.ts`
- `apps/cloud-web/app/(dashboard)/packs/author/onboarding/page.tsx`
- `apps/cloud-web/app/(dashboard)/packs/author/payouts/page.tsx`
- DB migrations.

### Schema additions

```sql
CREATE TABLE pack_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  seats INT NOT NULL,
  gross_usd_cents BIGINT NOT NULL,
  author_share_usd_cents BIGINT NOT NULL,    -- 70% rounded down
  platform_share_usd_cents BIGINT NOT NULL,
  paid_out BOOLEAN NOT NULL DEFAULT false,
  paid_out_at TIMESTAMPTZ,
  stripe_transfer_id TEXT
);
CREATE INDEX idx_pack_revenue_pack ON pack_revenue(pack_id);
```

### Onboarding

- Author goes to `/packs/author/onboarding`.
- We create a Stripe Connect Express account.
- Stripe-hosted onboarding form fills bank info, ID verification.
- On `account.updated` webhook, we mark `pack_authors.payout_account_id`.

### Monthly payout job

- Runs on the 5th of each month.
- For the previous month: SUM(seats × price × 70%) per author.
- Creates Stripe Transfer to author's connected account.
- Records `pack_revenue` rows.

### Tests

- Payout calculation against fixture revenue.
- Stripe Connect onboarding mock flow.
- Failed transfer retry logic.

### Acceptance criteria

- [ ] Author can onboard via Stripe Connect.
- [ ] Monthly payout runs on schedule.
- [ ] Payout history visible in dashboard.
- [ ] Tax forms (1099-K) handled by Stripe Connect.
- [ ] Documented payout terms at chemag.dev/payouts.
