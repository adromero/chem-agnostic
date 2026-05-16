# ADR 0007 — Pivot from framework to ESLint plugin (post-Gate-1)

- Status: Accepted
- Date: 2026-05-14
- Stage: Track S — WP-S01
- Supersedes: nothing structurally, but reframes the productization
  intent of ADRs 0001–0006
- Driven by: Gate-1 verdict (`spend-tracker-bench/results/GATE-1.md`,
  2026-05-14) + prior-art survey (CodelyTV's plugin, Bardia's
  standards, the architecture-patterns Claude Code skill, the muthu.co
  article)

## Context

The Gate-1 bench re-run after Track R closed told us two things:

1. **The three new semantic rules work mechanically.** Across both
   control runs they fired on real violations: 11 + 10 `CHEM-BOND-003`,
   7 + 8 `CHEM-PORT-004`, 0 + 0 in both treatment arms. The composite
   delta nearly doubled vs run-1 (+0.075 → +0.1475) and the subjective
   gap halved (−0.25 → −0.125).
2. **The framework around the rules still loses to prose.** Treatment-1
   produced a 551-line God-file catalyst because of how chemag's
   `compound_types.catalyst.allowed_roles: [adapter]` constraint forces
   route logic into the catalyst. Treatment-2 produced the cleanest
   architecture in either arm, but the variance is per-agent, not
   per-arm — the framework doesn't *cause* the wins. The locked
   rubric's "treatment scores worse on subjective" override still
   triggers NEGATIVE.

Meanwhile a 30-minute survey of competing prior art found:

- **CodelyTV/eslint-plugin-hexagonal-architecture** (317★) — occupies
  the ESLint slot for hexagonal architecture. One rule (folder layout +
  cross-layer imports). Less sophisticated than our PORT-003/004 but
  it's the existing home for this kind of check.
- **`architecture-patterns` Claude Code skill** (secondsky) — teaches
  Clean Architecture, Hexagonal Architecture, DDD to Claude. Our
  "methodology" would be one of several.
- **`bardiakhosravi/ai-agent-backend-standards`** — 24 detailed
  hexagonal+DDD rules distributed as `.cursorrules` / Windsurf config /
  `CLAUDE.md`. Multi-tool support out of the box.
- **`symfony-hexagonal-skill`** (aligundogdu) — Claude Code plugin
  enforcing hexagonal architecture with 10 auto-triggered skills + 2
  review agents + progressive refactoring. The most direct structural
  competitor.
- **"The Architecture is the Prompt"** (muthu.co, Nov 2025) — same
  thesis we discovered through the bench: clean architecture beats
  elaborate prompting because structure enforces boundaries.

The only thing in our work that's not duplicated is the three rules
themselves — specifically the symbol-resolution-through-barrel-chain
logic in PORT-003 and the role+compound resolution in PORT-004. Those
are real, narrow, and useful.

## Decision

Wind down chemag-the-framework. Ship the three rules as
`eslint-plugin-port-discipline`. Make this repo's top-level README the
public writeup of the bench. Don't migrate users (there are none besides
the operator). Don't delete code (commits are part of the story).

Specifically, three decisions:

### 1. Which framework packages get deprecated

**Deprecated** (mark in `package.json`, header in README, no code
deletion):

- `packages/cli` — the `chemag` CLI
- `packages/plugin-typescript`
- `packages/plugin-python`
- `packages/plugin-go`
- `packages/lsp-server`
- `packages/mcp-server`
- `packages/vscode-extension`
- `packages/telemetry`
- `packages/github-action`

**Kept**:

- `packages/core` — the ESLint plugin's tests reuse its bench fixtures
  in `packages/core/test/fixtures/semantic-rules/`. Types and the
  diagnostic-codes registry remain useful as a reference even after
  the CLI is deprecated.

**New**:

- `packages/eslint-plugin/` — `eslint-plugin-port-discipline`.

### 2. ESLint plugin published name

**`eslint-plugin-port-discipline`** (unscoped).

Reasoning: ESLint plugins are conventionally unscoped. `eslint-plugin-*`
discovery is convention-driven (eslint config arrays accept the suffix
as a shorthand). Scoped names work but add friction. Author identity
lives in `package.json#author` and the GitHub repo, not the package
name.

### 3. README structure (long-form writeup as repo README)

**Two READMEs:**

- `README.md` (top-level) — the long writeup. ~2500-3500 words. Methodology, bench results, what didn't work, what we're shipping, related
  work. This is the public face when someone lands on the GitHub repo.

- `packages/eslint-plugin/README.md` — short, npm-facing. Quickstart +
  rule docs + link back up. This is what npm shows on the package page.

Reasoning: npm visitors need install-and-use info fast. Repo visitors
want the story. Splitting serves both without duplicating content.

## Consequences

### Immediate

- Gate-2 will not run. Track R is closed as-is. The master plan files
  `05-track-3-commercial-cloud.md` through `08-track-6-gtm.md` stay
  paused indefinitely. The master plan as a whole closes once Track S
  (WP-S01 through WP-S07) ships.
- The chemag CLI installed globally on developer machines via
  `pnpm --filter @chemag/cli link --global` will start surfacing
  deprecation warnings after Track S ships.
- All packages still build (`pnpm build` green, `pnpm test` green) —
  deprecation is a publishing/docs concern, not a code-deletion one.

### Long-term

- If `eslint-plugin-port-discipline` gets traction (>100 stars or
  meaningful npm downloads), that's a signal to revisit. It is NOT a
  commitment to do so — the operator explicitly does not want to sign
  up for maintenance.
- If CodelyTV accepts the contribution (WP-S06), the standalone plugin
  may eventually merge into theirs. Until and unless that happens, both
  coexist.
- ADRs 0001–0006 remain factually accurate for the work that was done.
  They are not retconned. They describe a framework that existed; this
  ADR records that the framework's productization is being wound down
  in favor of a smaller artifact.

### Rejected alternatives

- **(A) Ship WP-R06/R07 (catalyst-config fix + Error allowlist) and
  re-run Gate-2.** Plausible but doesn't address the core problem — the
  bench already told us framework-first is the wrong shape. Doing
  another bench cycle would spend ~1 work-week to validate what's
  already known.
- **(B) Reposition chemag as a scaffolding/doc tool.** Could work, but
  the scaffolding space is also crowded (cookiecutter, Yeoman,
  `pnpm create`). And without enforcement, the only thing left is a
  prose template, which is what Bardia and several others already
  ship. No clear edge.
- **(C) Keep building the framework, ignore the bench.** Not a serious
  option. The bench is pre-registered with locked rubric; ignoring it
  would be dishonest.

## Verification

This ADR is verifiable through:

- `spend-tracker-bench/results/GATE-1.md` — the verdict that prompted
  the pivot
- The prior-art survey findings in the conversation log (2026-05-14)
- The Track S plan at `docs/master-plan/12-track-S-shipping.md`

Once WP-S07 ships, this ADR can also be verified against the public
npm package and the top-level README.
