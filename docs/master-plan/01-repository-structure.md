# Target Repository Structure

The current repo is a single npm package. WP-001 converts it to a pnpm workspace + Turborepo monorepo. This document is the *target* end-state after all 60 WPs ship.

## Top-level layout

```
chem-agnostic/
├── package.json                  # Workspace root (private, not published)
├── pnpm-workspace.yaml           # Workspace member declarations
├── turbo.json                    # Turborepo pipeline config
├── tsconfig.base.json            # Shared TS config
├── .changeset/                   # Changesets for versioning + changelog
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                # Lint + test + build all packages
│   │   ├── release.yml           # Changesets-driven release
│   │   ├── cloud-deploy.yml      # Deploy cloud-api + cloud-web on main
│   │   ├── marketing-deploy.yml  # Deploy marketing site on main
│   │   ├── docs-deploy.yml       # Deploy docs site on main
│   │   ├── benchmark-nightly.yml # Run benchmark suite nightly
│   │   └── e2e.yml               # Cross-package E2E tests
│   ├── actions/
│   │   └── chem-ag/              # Reusable composite action (also published as chemag-org/action@v1)
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── CODEOWNERS
├── docs/
│   ├── master-plan/              # This planning directory
│   ├── rfcs/                     # Existing RFCs (kept)
│   └── adrs/                     # Architecture decision records (created in WP-007)
├── packages/                     # Publishable packages (npm + pypi)
│   ├── cli/                      # @chemag/cli — current src/ moves here
│   ├── core/                     # @chemag/core — shared types, vocabulary, diagnostics
│   ├── plugin-typescript/        # @chemag/plugin-typescript
│   ├── plugin-python/            # @chemag/plugin-python (also publishes pypi: chemag-plugin-python)
│   ├── plugin-go/                # @chemag/plugin-go (Go binary)
│   ├── mcp-server/               # @chemag/mcp-server
│   ├── vscode-extension/         # chemag-vscode (publishes to VS Marketplace)
│   ├── github-action/            # @chemag/github-action (the runtime, separate from the composite wrapper)
│   ├── benchmark-harness/        # @chemag/benchmark
│   ├── rule-pack-sdk/            # @chemag/rule-pack-sdk (for community pack authors)
│   └── telemetry/                # @chemag/telemetry (opt-in usage analytics)
├── apps/                         # Non-publishable runnable applications
│   ├── cloud-api/                # chemag.cloud backend (Fastify + Postgres)
│   ├── cloud-web/                # chemag.cloud frontend (Next.js 14 App Router)
│   ├── marketing/                # chemag.dev landing site (Astro)
│   ├── docs-site/                # docs.chemag.dev (Astro Starlight)
│   └── reference-monorepo/       # Demo monorepo used in benchmarks + docs
├── bench/                        # Benchmark fixtures + result archives
│   ├── prompts/                  # YAML prompt definitions
│   ├── fixtures/                 # Reference codebases
│   ├── results/                  # JSON result archives (committed for reproducibility)
│   └── leaderboard/              # Public leaderboard generator
├── infra/                        # Deployment + ops
│   ├── docker/                   # Dockerfiles for cloud services
│   ├── fly/                      # fly.toml configs
│   ├── terraform/                # IaC for Postgres, R2, secrets
│   └── migrations/               # Postgres migrations (managed via drizzle-kit)
├── scripts/                      # Repo-wide scripts (release, codegen, etc.)
├── tools/                        # Internal tooling (e.g. cross-package codegen)
├── .editorconfig
├── .nvmrc                        # Node 22 LTS
├── .npmrc                        # pnpm settings
├── biome.json                    # Biome config (lint + format, replaces ESLint+Prettier)
└── README.md                     # Top-level README points to docs site
```

## Per-package structure

### `packages/cli/`

```
packages/cli/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts                    # Entry point (existing, refactored)
│   ├── commands/
│   │   ├── init.ts               # was cmd-init.ts
│   │   ├── add.ts
│   │   ├── check.ts
│   │   ├── analyze.ts
│   │   ├── scaffold.ts
│   │   ├── graph.ts
│   │   ├── sync.ts
│   │   ├── check-edit.ts         # NEW (WP-004)
│   │   ├── emit-rules.ts         # NEW (WP-009)
│   │   ├── install-hooks.ts      # NEW (WP-010)
│   │   ├── mcp.ts                # NEW (WP-014) — invokes mcp-server
│   │   ├── pack.ts               # NEW (WP-045) — pack add/remove
│   │   └── ci.ts                 # NEW (WP-023) — thin CI wrapper
│   ├── format/
│   │   ├── human.ts              # Default colored output
│   │   ├── json.ts               # JSON output
│   │   ├── sarif.ts              # SARIF 2.1.0 output
│   │   └── junit.ts              # JUnit XML
│   ├── cache/
│   │   ├── manifest-cache.ts     # WP-003
│   │   └── content-hash.ts
│   ├── plugin-loader.ts          # existing, extended for Go in WP-021
│   └── version.ts                # Single source of truth for CLI version
└── test/                         # Tests mirror src/
```

### `packages/core/`

```
packages/core/
├── package.json
├── src/
│   ├── types.ts                  # was src/types.ts
│   ├── plugin-interface.ts       # was src/plugin-interface.ts
│   ├── checks.ts                 # was src/checks.ts
│   ├── import-check.ts           # was src/import-check.ts
│   ├── loader.ts                 # was src/loader.ts
│   ├── graph.ts                  # was src/graph.ts
│   ├── scaffold.ts               # was src/scaffold.ts
│   ├── sync.ts                   # was src/sync.ts
│   ├── vocabulary/
│   │   ├── index.ts              # tr() function (WP-002)
│   │   ├── chemistry.json
│   │   └── standard.json
│   ├── diagnostics/
│   │   ├── codes.ts              # Error code registry (WP-007)
│   │   ├── format.ts
│   │   └── messages.ts
│   └── telemetry/                # Re-export from @chemag/telemetry
└── test/
```

### `packages/plugin-go/`

```
packages/plugin-go/
├── package.json
├── src/
│   ├── index.ts                  # LanguagePlugin implementation
│   ├── parser.ts
│   └── generator.ts
├── go-helper/                    # Go subprocess for AST parsing
│   ├── go.mod
│   ├── main.go                   # Reads JSON from stdin, writes parse results to stdout
│   └── parse.go
└── test/
```

### `apps/cloud-api/`

```
apps/cloud-api/
├── package.json
├── tsconfig.json
├── src/
│   ├── server.ts                 # Fastify entry
│   ├── routes/
│   │   ├── auth.ts               # Clerk webhooks
│   │   ├── orgs.ts
│   │   ├── repos.ts
│   │   ├── violations.ts         # Webhook ingestion
│   │   ├── runs.ts
│   │   ├── packs.ts              # Marketplace API
│   │   ├── billing.ts            # Stripe webhooks
│   │   ├── slack.ts
│   │   ├── pagerduty.ts
│   │   └── github-app.ts
│   ├── db/
│   │   ├── schema.ts             # Drizzle schema
│   │   ├── client.ts
│   │   └── seed.ts
│   ├── jobs/
│   │   ├── ingest-violations.ts  # BullMQ worker
│   │   ├── nightly-rollup.ts
│   │   └── email.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── rbac.ts
│   │   ├── rate-limit.ts
│   │   └── audit-log.ts
│   ├── lib/
│   │   ├── stripe.ts
│   │   ├── clerk.ts
│   │   ├── github.ts
│   │   ├── slack.ts
│   │   ├── pagerduty.ts
│   │   └── r2.ts                 # Cloudflare R2 client
│   └── config.ts
└── test/                         # Vitest + supertest
```

### `apps/cloud-web/`

```
apps/cloud-web/
├── package.json
├── next.config.mjs
├── app/                          # Next.js 14 App Router
│   ├── (auth)/
│   │   ├── sign-in/
│   │   └── sign-up/
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Org overview
│   │   ├── repos/
│   │   ├── violations/
│   │   ├── drift/
│   │   ├── packs/
│   │   ├── settings/
│   │   └── billing/
│   ├── (marketing)/              # Public marketing pages live in apps/marketing instead
│   ├── api/                      # Internal API routes (proxy to cloud-api)
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                       # shadcn/ui components
│   ├── violations/
│   ├── repos/
│   └── billing/
├── lib/
│   ├── api-client.ts
│   ├── auth.ts
│   └── analytics.ts              # PostHog
└── test/                         # Playwright + Vitest
```

### `apps/marketing/`

```
apps/marketing/
├── package.json
├── astro.config.mjs
├── src/
│   ├── pages/
│   │   ├── index.astro
│   │   ├── pricing.astro
│   │   ├── benchmark.astro       # Live leaderboard view
│   │   ├── integrations.astro
│   │   ├── customers.astro
│   │   └── blog/
│   ├── components/
│   │   ├── Hero.astro
│   │   ├── PricingTable.astro
│   │   ├── Demo.astro            # Embedded asciinema
│   │   └── ComparisonTable.astro
│   └── content/
│       └── blog/                 # MDX blog posts
└── public/
```

### `apps/docs-site/`

```
apps/docs-site/
├── package.json
├── astro.config.mjs              # Astro Starlight
├── src/
│   ├── content/
│   │   └── docs/
│   │       ├── getting-started/
│   │       ├── concepts/
│   │       ├── cli-reference/    # Auto-generated by tools/codegen-cli-docs.ts
│   │       ├── plugins/
│   │       ├── ai-integrations/
│   │       │   ├── claude-code.md
│   │       │   ├── cursor.md
│   │       │   ├── codex.md
│   │       │   ├── copilot.md
│   │       │   └── aider.md
│   │       ├── ci-integrations/
│   │       ├── mcp-server.md
│   │       ├── cloud/
│   │       ├── marketplace/
│   │       └── benchmark/
│   └── plugins/                  # Custom Starlight plugins
└── public/
```

### `apps/reference-monorepo/`

A real-ish monorepo used as a fixture for benchmarks, screenshots, and integration tests.

```
apps/reference-monorepo/
├── workspace.yaml
├── apps/
│   ├── web/                      # TypeScript (Next.js)
│   │   └── src/compounds/
│   ├── api/                      # Python (FastAPI)
│   │   └── src/compounds/
│   └── worker/                   # Go (background jobs)
│       └── compounds/
├── packages/
│   ├── contracts/
│   ├── ui-kit/
│   └── shared-domain/
└── infra/
```

About 30 modules / 200 files / 3 languages. Substantive enough that violations are realistic but small enough to run benchmarks against in <60s.

### `bench/`

```
bench/
├── package.json
├── README.md
├── prompts/
│   ├── auth-001.yaml             # "Add OAuth login"
│   ├── payments-002.yaml
│   ├── ... (40 total)
├── fixtures/                     # Snapshot of reference-monorepo at known SHAs
│   ├── before/                   # Pre-prompt repo state
│   └── ground-truth/             # Expected post-prompt state
├── harness/
│   ├── run.ts                    # Orchestrator
│   ├── runners/
│   │   ├── claude-code.ts
│   │   ├── cursor-cli.ts
│   │   ├── codex.ts
│   │   ├── aider.ts
│   │   └── copilot-cli.ts
│   ├── scoring/
│   │   ├── placement.ts          # Did file land in right module?
│   │   ├── self-correction.ts    # On block, did it recover?
│   │   ├── token-cost.ts
│   │   └── time-to-correct.ts
│   └── report.ts
├── results/
│   └── 2026-MM-DD-runId/         # Each run is an immutable folder
│       ├── manifest.json
│       └── per-prompt/
└── leaderboard/
    └── generate.ts               # Pulls latest run, regenerates marketing/benchmark/index
```

## Versioning strategy

- Single version per package, managed by Changesets.
- The CLI (`@chemag/cli`) tracks the public product version (1.0.0 at launch).
- Other packages can have independent versions but bump together for v1.0 release.
- Semver enforced: any breaking CLI change requires a major bump and a deprecation cycle of at least one minor version.

## Naming conventions

- npm scope: `@chemag` (must be registered before WP-001 ships).
- pypi package: `chemag-plugin-python` (pypi disallows nested namespaces).
- Go module: `github.com/chemag-org/plugin-go` (the Go subprocess is published separately).
- VS Code extension: `chemag.chemag-vscode` (publisher.name).
- Public binary name: `chemag` (was `chem-ag` — drop the hyphen for shell ergonomics; alias `chem-ag` retained for backwards compat per WP-001).
- Cloud product names: `chemag.cloud` (app), `chemag.dev` (marketing), `docs.chemag.dev` (docs).
- GitHub org: `chemag-org`.

## Domains and external services

| Service | Domain / Account |
|---|---|
| Marketing | chemag.dev |
| Cloud app | chemag.cloud |
| Docs | docs.chemag.dev |
| Status page | status.chemag.cloud |
| API | api.chemag.cloud |
| GitHub org | github.com/chemag-org |
| npm scope | npmjs.com/org/chemag |
| Discord | invite link in marketing site footer |
| Twitter/X | @chemag_dev |
| Bluesky | @chemag.dev |

DNS, GitHub org, npm scope, and Stripe account are prerequisites — must exist before the conductor begins. Captured in `docs/master-plan/PREREQUISITES.md` (created in WP-001).

## Tooling baseline

| Concern | Choice | Rationale |
|---|---|---|
| Package manager | pnpm 9.x | Workspaces, deterministic, fast |
| Monorepo tasks | Turborepo | Caching, remote cache via Vercel free tier |
| TS compile | tsc + tsup for builds | tsup is fast, dual ESM/CJS |
| Lint + format | Biome 1.x | Single binary, fast, replaces ESLint+Prettier |
| Test runner | Vitest 3.x | Already used; fast, native ESM |
| Docs site | Astro Starlight | MDX, fast, low-maintenance |
| Marketing site | Astro | Same toolchain as docs |
| Cloud frontend | Next.js 14 App Router | RSC, ecosystem, Vercel deploy |
| Cloud backend | Fastify + Drizzle ORM + Postgres 16 | Fast, typed, simple |
| Job queue | BullMQ + Redis | Mature, simple |
| Auth | Clerk (initial) | Auth + orgs out of the box |
| Object storage | Cloudflare R2 | Cheaper than S3 for our access patterns |
| Email | Resend | Devex, decent pricing |
| Telemetry | PostHog (cloud + product analytics) | Self-hostable later if needed |
| Error tracking | Sentry | Standard |
| Stripe | Standard | Billing |
| Hosting | Vercel (web/marketing/docs), Fly.io (cloud-api), Upstash Redis | Sane defaults |
| CDN | Cloudflare | Bundled with R2 |
| DNS | Cloudflare | Same |
