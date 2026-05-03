# Track 6 — GTM Launch (WP-052 through WP-060)

Track 6 ships the public face: marketing site, docs, pricing, content, community, distribution. Most WPs depend on prior track output; sequencing is constrained more by content readiness than code dependencies.

## Sequencing within track

```
WP-052 (marketing site) ─┐
WP-053 (docs site) ──────┼─→ WP-054 (pricing + WTP) ─→ WP-055 (waitlist + email)
                          │                              ↓
WP-057 (PostHog flags) ───┘                            WP-056 (blog content)
                                                          ↓
                                                     WP-058 (Discord) ─→ WP-059 (demo videos) ─→ WP-060 (launch playbook)
```

---

## WP-052 — Marketing site (chemag.dev)

**Track:** 6
**Effort:** L
**Depends on:** WP-001 (apps/marketing scaffold)
**Blocks:** WP-054, WP-055

### Pages

- `/` — Hero, "what it is" in 30 seconds, demo video, leaderboard preview, customer logos placeholder.
- `/integrations` — grid of all AI editors and CI systems we support.
- `/cloud` — chemag.cloud product page.
- `/marketplace` — pack browser (consumes WP-042 API).
- `/benchmark` — live leaderboard (WP-050).
- `/pricing` — pricing table, FAQ, "talk to sales" for enterprise.
- `/customers` — case studies (post-launch).
- `/blog` — MDX-driven blog.
- `/changelog` — auto-generated from Changesets.
- `/security` — WP-040 content.
- `/privacy`, `/terms`, `/dpa`, `/subprocessors`, `/payouts`.
- `/about` — team, mission.

### Visual identity

- Logo: simple, neutral. Two variants: chemistry mode (a benzene-ring-style hex) and standard mode (a layered-rectangle stack). The vocabulary toggle on the homepage swaps logo variants subtly.
- Type: Inter (UI), JetBrains Mono (code).
- Color: dark mode default. Accent palette TBD by branding ADR (`docs/adrs/0011-branding.md`).
- Components: Astro + Tailwind + custom components; no shadcn/ui (we want a distinct visual identity vs the dashboard).

### Performance

- LCP <2.0s on 4G.
- Lighthouse Perf ≥90, Acc ≥95, SEO ≥95.
- Static-rendered, edge-cached on Cloudflare.

### Tests

- Lighthouse CI on every page.
- Playwright smoke tests (each top-level page renders).
- axe-core accessibility checks.

### Acceptance criteria

- [ ] Public site live at chemag.dev.
- [ ] Vocabulary toggle on homepage swaps copy across major sections.
- [ ] Demo video embedded above the fold.
- [ ] Pricing page links to Stripe Checkout for free trials.

---

## WP-053 — Docs site (docs.chemag.dev)

**Track:** 6
**Effort:** L
**Depends on:** WP-001, all CLI/MCP/Cloud WPs (for content)
**Blocks:** WP-060

### Description

Astro Starlight-based docs at docs.chemag.dev. Auto-generated CLI, MCP, REST reference; hand-written guides; integration walkthroughs.

### Sections

- **Get started**: install, init, first compound, first analyze.
- **Concepts**: roles, bonds, compounds, public surfaces, rule packs.
- **CLI reference**: auto-generated from `tools/codegen-cli-docs.ts` (one page per command).
- **Plugins**: TypeScript, Python, Go, authoring a plugin.
- **AI integrations**: Claude Code, Cursor, Codex, Copilot, Aider, Cline.
- **MCP server**: install, tools, resources, troubleshooting.
- **CI integrations**: GitHub Action, GitLab, Bitbucket, Jenkins (instructions only).
- **Cloud**: account, repos, integrations, billing, exports.
- **Marketplace**: browse, install, author, publish.
- **Benchmark**: methodology, reproducing, contributing prompts.
- **Vocabulary**: standard vs chemistry, switching.
- **Telemetry & privacy**.
- **Troubleshooting**.

### Auto-generation

- `tools/codegen-cli-docs.ts` parses CLI command definitions (citty introspection) and produces markdown.
- `tools/codegen-mcp-docs.ts` parses MCP tool/resource registrations.
- `tools/codegen-rest-docs.ts` produces REST docs from the OpenAPI spec.
- All run in CI; missing entries fail the build.

### Search

- Algolia DocSearch (free for OSS docs).

### Tests

- Build succeeds with no broken links.
- Dead-link checker in CI.
- Each command has a doc page (enforced by codegen test).

### Acceptance criteria

- [ ] All 60 WPs' user-facing surface documented.
- [ ] Search works across all content.
- [ ] Lighthouse ≥90 on key pages.
- [ ] Accessibility ≥95.

---

## WP-054 — Pricing page + WTP A/B test

**Track:** 6
**Effort:** M
**Depends on:** WP-037, WP-052, WP-057
**Blocks:** WP-055

### Description

Public pricing page with three variants (A: $19, B: $29, C: $49 per seat/month) served via PostHog feature flags. Conversion tracked through Stripe Checkout completion.

### Files to create

- `apps/marketing/src/pages/pricing.astro`
- `apps/marketing/src/lib/posthog-flag.ts`
- `apps/marketing/src/components/PricingTable.astro`

### Variants

- A ($19): Aggressive entry. "Team" tier $19/seat/mo, annual $15/seat/mo.
- B ($29): "Team" tier $29/seat/mo, annual $23/seat/mo.
- C ($49): "Team" tier $49/seat/mo, annual $39/seat/mo.

All three include the same features.

### Tracking

- Variant assignment per visitor (sticky via cookie).
- PostHog event: `pricing_viewed { variant }`.
- Stripe Checkout completion: `subscribed { variant, plan, amount }`.
- WTP via van Westendorp survey embedded on the pricing page (optional micro-survey).

### Decision rule (post-launch)

- After 4 weeks: pick the variant with the highest revenue per visitor (LTV-adjusted) AND not the bottom in conversion rate. Discontinue the others.

### Tests

- Variant assignment deterministic per visitor.
- Stripe Checkout completion correctly attributed.
- van Westendorp results stored in PostHog.

### Acceptance criteria

- [ ] Three pricing variants live in production behind a flag.
- [ ] Tracking verified end-to-end.
- [ ] Documented decision rule.

---

## WP-055 — Waitlist + email automation

**Track:** 6
**Effort:** M
**Depends on:** WP-052
**Blocks:** WP-060

### Description

Pre-launch waitlist + post-launch nurture. Resend for transactional + drip emails.

### Files to create

- `apps/cloud-api/src/routes/waitlist.ts` (signup endpoint).
- `apps/marketing/src/components/WaitlistForm.astro`.
- `apps/cloud-api/src/jobs/email-drip.ts`.
- `apps/cloud-api/src/templates/email/*.tsx` (react-email).
- DB migration for `waitlist`, `email_events`.

### Drip sequences

- **Pre-launch**: 5 emails (announcement, demo video, benchmark teaser, Slack invite, launch day).
- **Trial nurture**: 7 emails over 14 days (welcome, first compound, first analyze, AI integration, first violation found, upgrade reminder, trial ending).
- **Post-cancel**: 1 email (sorry to see you go, feedback link).
- **Newsletter**: monthly product update + benchmark refresh.

### Acceptance criteria

- [ ] Waitlist form deduplicates emails.
- [ ] Pre-launch sequence sent on schedule.
- [ ] Trial nurture sent automatically.
- [ ] Unsubscribe link on every email.
- [ ] CAN-SPAM / GDPR compliant.

---

## WP-056 — Launch content (blog posts + social)

**Track:** 6
**Effort:** L
**Depends on:** WP-050, WP-053
**Blocks:** WP-060

### Description

Pre-written, edited, scheduled launch content. The benchmark is the headline.

### Posts to write

1. **Launch announcement**: "Introducing chemag — polyglot architecture guardrails for AI coding agents."
2. **The benchmark paper**: "We benchmarked Claude Code, Cursor, Codex, and Aider on architecture rules — here's what we found."
3. **Why we built this**: founder's POV, the problem in 2026, why now.
4. **Polyglot architecture**: deep dive on the cross-language model.
5. **Rule packs**: how to author one + first-party pack tour.
6. **Migrating from dependency-cruiser / tach / import-linter**: comparison + migration guides.
7. **The MCP server**: how AI agents query architecture.
8. **Hooks > rules files**: the deterministic enforcement argument.

### Social

- Launch thread (Twitter/Bluesky/LinkedIn): 12-tweet narrative anchored on the benchmark.
- Hacker News Show post (the benchmark angle).
- r/programming + r/MachineLearning + r/devops crossposts.
- DEV.to mirror of the benchmark post.

### Tests

- Spell-check, grammar-check.
- Editorial review checklist.

### Acceptance criteria

- [ ] All 8 blog posts drafted, reviewed, scheduled.
- [ ] Social posts queued.
- [ ] HN/Reddit copy in `docs/master-plan/launch-copy.md` (private; not committed publicly until launch day).

---

## WP-057 — PostHog feature flags + analytics

**Track:** 6
**Effort:** S
**Depends on:** WP-001
**Blocks:** WP-054

### Description

Wire PostHog into marketing, cloud-web, and CLI (telemetry already covered in WP-006). Feature flags drive A/B tests; analytics drive funnel insights.

### Files to create

- `apps/marketing/src/lib/posthog.ts`
- `apps/cloud-web/lib/posthog.ts`
- `apps/cloud-api/src/lib/posthog.ts` (server-side capture).
- `docs/internal/analytics-events.md` — registry of events.

### Events tracked (cloud)

- `signup_completed`, `org_created`, `repo_installed`, `first_run_completed`, `first_violation_resolved`, `pack_installed`, `subscribed`, `cancelled`, `compliance_export_generated`, etc.

### Acceptance criteria

- [ ] Events visible in PostHog dashboard.
- [ ] Funnels created: visit → signup → install → trial → paid.
- [ ] Feature flags control variants.

---

## WP-058 — Discord community + bot

**Track:** 6
**Effort:** S
**Depends on:** WP-001
**Blocks:** WP-060

### Description

Discord server with channels: #announcements, #help, #showcase, #pack-authors, #benchmark, #releases. Optional GitHub Discussions instead — choose via ADR `docs/adrs/0012-community-platform.md`.

### Bot features

- Auto-post releases to #releases (consumes Changesets webhook).
- Auto-post benchmark refreshes to #benchmark.
- `/check` slash command in #help that triggers a one-time `chemag check` against an attached workspace.yaml (sandboxed).

### Acceptance criteria

- [ ] Server provisioned.
- [ ] Bot deployed.
- [ ] Invite link on chemag.dev.
- [ ] Code of Conduct + moderation guidelines committed.

---

## WP-059 — Demo videos + asciinema

**Track:** 6
**Effort:** M
**Depends on:** WP-018, WP-026, WP-033, WP-052
**Blocks:** WP-060

### Description

Recorded demos used across the marketing site, blog, social.

### Demos to produce

1. **30-second hero**: chemag installs, blocks a Claude Code edit, agent self-corrects. (chemag.dev homepage above-the-fold.)
2. **2-minute walkthrough**: full init → add → check → analyze → emit-rules → install-hooks. (chemag.dev/getting-started.)
3. **VS Code extension demo**: 90 seconds, sidebar + diagnostics + code action. (Marketplace listing + VS Code page.)
4. **Cloud dashboard demo**: 90 seconds, install GitHub App → see violations → Slack notification → compliance export. (chemag.cloud landing.)
5. **Marketplace demo**: 60 seconds, browse → install pack → see new rules apply. (chemag.dev/marketplace.)
6. **Benchmark demo**: 60 seconds, leaderboard tour, click into a prompt result. (chemag.dev/benchmark.)
7. **MCP demo**: 60 seconds, agent calling `where_should_this_go` and acting on the answer.

### Production

- Recorded with Loom or OBS, edited in DaVinci Resolve.
- asciinema casts for terminal flows (smaller, embeddable, faster).
- Subtitles + transcripts for accessibility.
- Hosted on Cloudflare Stream.

### Acceptance criteria

- [ ] All 7 demos produced and embedded.
- [ ] Each <2.5MB asciinema cast / <30MB MP4 with H.264.
- [ ] Captions on every video.

---

## WP-060 — Launch playbook + week-of execution

**Track:** 6
**Effort:** M
**Depends on:** all preceding WPs
**Blocks:** none (this is the terminal WP)

### Description

The week-of-launch playbook. Day-by-day plan, owner per task, comms cadence, monitoring.

### Files to create

- `docs/master-plan/launch-playbook.md` (committed).
- `docs/master-plan/launch-day-runbook.md` (committed).
- `docs/master-plan/launch-comms-templates.md` (committed).

### T-minus schedule (relative to launch Monday)

- **T-21 days**: HN moderator courtesy email (we're launching, here's a heads-up).
- **T-14 days**: Pre-launch waitlist drip starts. Press kit assembled.
- **T-10 days**: Reach out to 30 podcast hosts + journalists. Personalized.
- **T-7 days**: Internal dry run. Ship dashboard final.
- **T-3 days**: Lock all branches. Code freeze on cloud.
- **T-1 day**: Final smoke tests. PagerDuty primary on-call assigned.
- **T 0 (Monday)**:
  - 06:00 PT: Product Hunt goes live (scheduled).
  - 06:30 PT: HN Show post.
  - 07:00 PT: Tweet thread.
  - 07:00 PT: Email blast.
  - 08:00 PT: Reddit + DEV.to crossposts.
  - 09:00 PT: All-hands status meeting (or solo founder Slack post).
  - Through the day: respond to every HN/PH comment within 30 min.
- **T+1**: Podcast appearance #1.
- **T+3**: Follow-up newsletter to waitlist.
- **T+7**: Retrospective doc + first metrics post.

### Monitoring

- PagerDuty primary on-call.
- Sentry severity escalation paths set.
- Status page actively maintained.
- Live dashboards (signups, conversions, errors) visible to all on-call.

### Press kit

- `apps/marketing/public/press-kit/` — logos (light/dark, SVG/PNG), founder photo, screenshots, one-pager PDF, quotes.

### Tests

- All launch URLs return 200.
- All redirects work.
- All Stripe price points are live.
- Email send infrastructure stress-tested at 10x expected launch volume.

### Acceptance criteria

- [ ] Playbook reviewed by all involved parties.
- [ ] Press kit complete.
- [ ] Smoke test signed off T-1 day.
- [ ] Status page live and external-monitor-watched.
- [ ] Post-launch retro document created (filled out T+7).
