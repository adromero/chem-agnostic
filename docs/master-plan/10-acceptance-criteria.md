# Definition of Done — v1.0 Launch

This document is the binary launch checklist. v1.0 launches when every item below is checked. Deviation requires an explicit ADR.

## Engine (CLI + plugins + MCP)

- [ ] All 60 WPs marked complete in `STATUS.md`.
- [ ] `chemag --version` reports `1.0.0`.
- [ ] All published packages: `@chemag/cli`, `@chemag/core`, `@chemag/plugin-typescript`, `@chemag/plugin-python`, `@chemag/plugin-go`, `@chemag/mcp-server`, `@chemag/rule-pack-sdk`, `@chemag/telemetry` on npm at `1.0.0`.
- [ ] `chemag-plugin-python` on PyPI at `1.0.0`.
- [ ] VS Code extension `chemag.chemag-vscode` on the Marketplace at `1.0.0`.
- [ ] GitHub Action `chemag-org/action@v1` published.
- [ ] All language plugins pass their reference monorepo (WP-018).
- [ ] All test suites pass on Node 22, Python 3.10–3.13, Go 1.22.
- [ ] Coverage targets met: ≥85% engine, ≥70% UI.
- [ ] No critical or high CVEs in any production dependency.
- [ ] All public CLI commands have docs pages (CI-enforced).
- [ ] All MCP tools and resources documented.
- [ ] All diagnostic codes documented.

## AI integrations

- [ ] `chemag install-hooks --tool claude` configures hooks correctly on a fresh repo.
- [ ] `chemag install-hooks --tool cursor` configures pre-commit + .cursor/rules.
- [ ] `chemag install-hooks --tool codex` configures pre-commit + AGENTS.md.
- [ ] `chemag install-hooks --tool aider` configures pre-commit + .aider/CONVENTIONS.md.
- [ ] `chemag install-hooks --tool cline` configures pre-commit + .clinerules.
- [ ] `chemag install-hooks --tool copilot` configures GitHub Action + copilot-instructions.md.
- [ ] `chemag emit-rules` outputs all 6 formats correctly.
- [ ] MCP server registers correctly with Claude Code and Cursor.
- [ ] All MCP tools verified end-to-end against MCP Inspector.

## CI integrations

- [ ] GitHub Action posts sticky PR comments and uploads SARIF.
- [ ] GitLab CI template posts MR comments.
- [ ] Bitbucket Pipe posts PR comments.
- [ ] All CI integrations documented in docs site.

## Cloud (chemag.cloud)

- [ ] Clerk auth working with email + GitHub + Google providers.
- [ ] GitHub App installable; webhook ingestion working.
- [ ] Push and PR events trigger runs.
- [ ] Dashboard pages all functional (overview, repos, violations, drift, packs, settings, billing).
- [ ] Slack integration working.
- [ ] PagerDuty integration working.
- [ ] Stripe billing working: free → trial → team → cancel paths all tested.
- [ ] Audit log capturing all mutations.
- [ ] RBAC enforced on every mutation.
- [ ] No source code stored in cloud (verified by schema review).
- [ ] SOC 2 readiness package complete.
- [ ] Privacy policy, ToS, DPA, subprocessors page live.
- [ ] Multi-region failover tested (single region for v1.0 — failover is "rebuild from scratch <2h" RTO).
- [ ] Daily DB backups confirmed working with restore drill.

## Marketplace

- [ ] 8 first-party packs published.
- [ ] Marketplace browsing working (public).
- [ ] Pack install/uninstall working from CLI and dashboard.
- [ ] Author Stripe Connect onboarding working.
- [ ] Monthly payout job tested.
- [ ] Pack signing + signature verification working.

## Benchmarks

- [ ] 40 prompts authored.
- [ ] 5 agent runners working.
- [ ] Nightly benchmark CI green.
- [ ] Public leaderboard live at chemag.dev/benchmark.
- [ ] Methodology paper on arXiv (or pre-submission acknowledgement).
- [ ] Reproducibility kit published.

## GTM

- [ ] chemag.dev live, all pages functional.
- [ ] docs.chemag.dev live, all sections populated.
- [ ] Pricing live with WTP A/B test.
- [ ] Waitlist + email automation tested.
- [ ] All 8 launch blog posts edited and scheduled.
- [ ] Social copy (HN, Reddit, X, Bluesky, DEV) drafted.
- [ ] All 7 demo videos produced.
- [ ] Discord live with bot.
- [ ] Press kit complete.
- [ ] Launch playbook reviewed.
- [ ] PagerDuty on-call assigned for launch day.
- [ ] Status page (status.chemag.cloud) live and external-monitor-watched.

## Performance budgets verified

- [ ] `chemag check` cold <1.5s, warm <300ms on reference monorepo.
- [ ] `chemag check-edit` warm <100ms.
- [ ] `chemag analyze` cold <3s, warm <600ms.
- [ ] Cloud API median <200ms, p99 <800ms.
- [ ] chemag.dev LCP <2.0s.
- [ ] chemag.cloud authenticated FCP <1.5s.

## Security baseline verified

- [ ] All secrets in vaulted env or Stripe/Clerk-managed.
- [ ] gitleaks green on every commit.
- [ ] osv-scanner green on every PR.
- [ ] TLS 1.3 minimum.
- [ ] DB encrypted at rest.
- [ ] Audit log append-only.
- [ ] Dependency upgrades automated.
- [ ] Penetration test done by an external firm before launch (out of code scope; operator schedules).

## Compliance

- [ ] Privacy policy reviewed by counsel.
- [ ] ToS reviewed by counsel.
- [ ] DPA template reviewed by counsel.
- [ ] PCI/HIPAA pack claims legally vetted.
- [ ] CCPA / GDPR right-to-erasure flow tested.
- [ ] Cookie consent banner on chemag.dev (if any tracking cookies are deployed).

## Operational

- [ ] On-call rotation defined.
- [ ] Runbooks for top 5 incident types committed.
- [ ] Sentry alert routes verified.
- [ ] Status page incident process documented.
- [ ] Backup restore drill executed within 30 days of launch.
- [ ] DR plan tested.

## Post-launch criteria (T+30 days)

- [ ] Retrospective doc filled.
- [ ] WTP test results captured; pricing decision made.
- [ ] First customer testimonials gathered.
- [ ] Top 5 user-reported bugs triaged and prioritized.
- [ ] First post-launch minor release shipped (1.1.0 or 1.0.1 depending on scope).

This document is the conductor's terminal goal. v1.0 ships when every box is checked. Anything not checkable becomes a post-launch hotfix.
