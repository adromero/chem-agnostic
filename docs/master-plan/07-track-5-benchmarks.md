# Track 5 — Benchmarks (WP-047 through WP-051)

The benchmark is both a product feature and the centerpiece of GTM content marketing. A public, reproducible leaderboard measuring AI agents' architecture-respect across coding tasks. Whatever the result, we publish — the headline writes itself either way.

## Sequencing within track

```
WP-047 (prompts) ─→ WP-048 (harness) ─→ WP-049 (runners) ─→ WP-050 (leaderboard) ─→ WP-051 (paper kit)
```

Track 5 needs WP-018 (reference monorepo) complete.

---

## WP-047 — Benchmark prompt library

**Track:** 5
**Effort:** M
**Depends on:** WP-018
**Blocks:** WP-048

### Description

Author 40 realistic "make this change" prompts against the reference monorepo. Each has a YAML manifest declaring expected outcomes (correct compound, correct role, correct dependency direction, etc.).

### Files to create

`bench/prompts/`:
- 40 YAML files, each named `<category>-<NNN>.yaml`.
- Categories (8 each):
  - `auth`: OAuth flows, password reset, 2FA, session management, OIDC, JWT.
  - `payments`: Stripe checkout, subscription, refunds, webhooks, dunning.
  - `data`: CRUD endpoints, complex queries, batch jobs, data exports.
  - `ui`: New page, form, error states, accessibility fixes, responsive layouts.
  - `infra`: Logging, caching, rate limiting, feature flags, observability.

### Prompt YAML schema

```yaml
api: 1
id: auth-001
title: "Add Google OAuth login"
prompt: |
  Implement Google OAuth 2.0 login. Users should land on /auth/google,
  get redirected to Google, and on return create or update a user record
  with their Google email + Google sub. Use the existing user repository
  pattern.
fixture_sha: "<sha-in-bench/fixtures/before/>"
ground_truth:
  files_created:
    - path_pattern: "apps/api/.*adapters/google_oauth_*.py"
      compound: "auth"
      role: "adapter"
    - path_pattern: "apps/api/.*reactions/login_with_google_*.py"
      compound: "auth"
      role: "reaction"
  files_modified: ["apps/api/.*compound.yaml"]
  must_not_violate:
    - rule: "CHEM-BOND-001"
    - rule: "CHEM-IMPORT-002"
  must_use_existing:
    - "UserRepository"  # interface from auth compound
  forbidden_patterns:
    - "stripe"          # Doesn't make sense for an auth task
    - "raw_sql"
scoring_weights:
  placement: 0.4
  bonds: 0.3
  uses_existing_interfaces: 0.2
  doesnt_create_violations: 0.1
```

### Quality bar

- Each prompt is realistic, drawn from common feature requests.
- Each prompt has a deterministic ground truth (multiple valid solutions OK; ground truth is a *set* of acceptable shapes).
- Prompts review-pair-tested by two contributors before commit.

### Tests

- Schema validation per prompt.
- Determinism: scoring against a known-correct fixture solution scores ≥0.95.

### Acceptance criteria

- [ ] 40 prompts authored.
- [ ] Each has a fixture SHA in `bench/fixtures/before/`.
- [ ] Schema-validated in CI.

---

## WP-048 — Benchmark harness

**Track:** 5
**Effort:** L
**Depends on:** WP-047
**Blocks:** WP-049

### Description

The orchestrator. Runs each prompt through each agent, captures outputs, runs scoring, persists results.

### Files to create

`bench/harness/`:
- `run.ts` — main entry: `bench run --agents claude-code,cursor --prompts auth-* --hooks on|off`.
- `scoring/`
  - `placement.ts`
  - `bonds.ts`
  - `uses-existing-interfaces.ts`
  - `forbidden-patterns.ts`
  - `index.ts` — combines per scoring_weights.
- `report.ts` — produces a JSON result archive + a markdown summary.
- `runner-base.ts` — abstract runner.
- `sandbox.ts` — runs each agent in a clean copy of the fixture, isolated container or temp dir.
- `git-utils.ts` — checkout fixture SHA, commit pre/post, diff.
- `manifest.ts` — captures run metadata (model, version, hooks, timestamp, env).

### Run loop

For each (prompt, agent, condition[hooks-on/off]):

1. Materialize the fixture at its `fixture_sha` into a clean temp dir.
2. Install chemag CLI + emit-rules + hooks (if condition is hooks-on).
3. Invoke the agent with the prompt.
4. Capture: agent's edits as a git diff, agent's tool call log (if available), token cost, wall time.
5. Score: run all scoring metrics; compute weighted aggregate.
6. Save: JSON to `bench/results/<runId>/<prompt>/<agent>/<condition>.json`.
7. Save: full repo diff (gzipped).

### Sandboxing

- Each prompt × agent runs in a Docker container based on `infra/docker/bench/Dockerfile`.
- Container has no network except to the agent's API endpoint.
- Filesystem isolated; volumes mounted read-only for fixtures.

### Tests

- Run a synthetic prompt against a mock agent that always emits a known correct diff; score ≥0.95.
- Run a mock agent that emits a violation; score reflects.
- Sandbox prevents network exfiltration outside allowlisted hosts.

### Acceptance criteria

- [ ] Single-prompt run completes in <2 minutes.
- [ ] Full 40-prompt × 5-agent × 2-condition matrix runs in <8 hours on a single CI runner.
- [ ] Results JSON validated against schema.

---

## WP-049 — Cross-agent runners

**Track:** 5
**Effort:** L
**Depends on:** WP-048
**Blocks:** WP-050

### Description

Concrete runners for the major agents.

### Files to create

`bench/harness/runners/`:
- `claude-code.ts` — invokes the Claude Code CLI in non-interactive mode.
- `cursor-cli.ts` — invokes cursor-agent (when available) or cursor's API.
- `codex.ts` — invokes Codex CLI.
- `aider.ts` — spawns aider with the prompt.
- `copilot-cli.ts` — gh copilot suggest / explain (limited; partial coverage).
- `mock.ts` — for harness self-tests.

### Common runner contract

```ts
export interface AgentRunner {
  readonly name: string;
  readonly version: string;
  setup(workdir: string, opts: { hooksEnabled: boolean }): Promise<void>;
  run(prompt: string, opts: { timeoutMs: number }): Promise<RunOutput>;
  teardown(): Promise<void>;
}

export interface RunOutput {
  exitCode: number;
  diff: string;                // git diff between pre and post
  toolCallLog?: ToolCall[];
  inputTokens?: number;
  outputTokens?: number;
  wallTimeMs: number;
  selfCorrected?: boolean;     // detected via tool-call replay if possible
  blockedAttempts?: number;    // how many times chemag blocked an edit
}
```

### Authentication

- Each runner reads its API key from env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.).
- The harness fails fast if a required key is missing for an agent in scope.

### Cost tracking

- Per run: input/output tokens × per-model pricing → USD.
- Aggregated in result manifest.

### Tests

- Mock runner produces known outputs.
- Per-runner integration tests gated behind env keys (skipped in PR CI; run nightly).

### Acceptance criteria

- [ ] All 5 runners implemented.
- [ ] All 5 produce comparable RunOutput.
- [ ] Cost tracking accurate against published pricing.

---

## WP-050 — Public leaderboard

**Track:** 5
**Effort:** L
**Depends on:** WP-049, apps/marketing scaffold
**Blocks:** WP-051

### Description

The leaderboard at `chemag.dev/benchmark`. Updated nightly. Shows agents ranked by composite score, broken down by category, hooks-on vs hooks-off comparison, and historical trends.

### Files to create

- `bench/leaderboard/generate.ts` — pulls latest run, regenerates the marketing page data.
- `apps/marketing/src/pages/benchmark/index.astro`
- `apps/marketing/src/pages/benchmark/[agent].astro` — per-agent deep dive.
- `apps/marketing/src/pages/benchmark/methodology.astro`
- `apps/marketing/src/pages/benchmark/[promptId].astro` — per-prompt deep dive with diffs.
- `apps/marketing/src/components/benchmark/ScoreTable.astro`
- `apps/marketing/src/components/benchmark/CategoryChart.astro`

### Visuals

- Composite score leaderboard (table).
- Hooks-on vs hooks-off comparison (bar chart).
- Per-category radar charts.
- Historical trend per agent (line chart).
- Diff viewer for any prompt × agent run.

### Reproducibility

- Each result row links to the JSON archive.
- Methodology page documents the harness, scoring, fixture SHAs.
- "Reproduce locally" instructions in each prompt page.

### Tests

- Leaderboard generation deterministic given the same input.
- Visual regression on key pages (Chromatic).

### Acceptance criteria

- [ ] Leaderboard live at chemag.dev/benchmark by launch.
- [ ] Updates nightly via `benchmark-nightly.yml`.
- [ ] Diff viewer works on real fixture results.
- [ ] Each agent has a deep-dive page.

---

## WP-051 — Reproducibility kit + paper

**Track:** 5
**Effort:** M
**Depends on:** WP-050
**Blocks:** GTM blog/social posts

### Description

A standalone repo plus an accompanying technical writeup that any researcher or skeptic can use to reproduce our benchmark on their own AI agent or prompt set.

### Files to create

- `bench/README.md` — full reproduction guide.
- `bench/methodology.md` — scoring, weights, sandboxing.
- `apps/marketing/src/content/blog/benchmark-launch.mdx` — launch post.
- `apps/marketing/src/content/blog/benchmark-methodology.mdx` — paper-style writeup.
- `tools/bench/release-archive.ts` — bundles a release tarball with fixtures + harness + scoring code for offline use.

### Submission targets

- arXiv preprint (cs.SE) — methodology paper.
- Hacker News Show post.
- Twitter/Bluesky launch thread.
- LessWrong / r/MachineLearning crossposts.

### Acceptance criteria

- [ ] External reproducer (a colleague unfamiliar with the codebase) can run the benchmark in <2 hours from clone.
- [ ] Paper draft ready for arXiv submission at v1.0 launch.
- [ ] Release archive published as a GitHub release.
