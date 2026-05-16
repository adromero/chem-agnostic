# Track S — Shipping (post-bench reframe)

Driven by Gate-1 (`spend-tracker-bench/results/GATE-1.md`, 2026-05-14) and
the survey of competing prior art in this space. The bench told us
chemag-the-framework doesn't beat prose for architecture quality, but the
three semantic rules from Track R (PORT-001, PORT-003, PORT-004) catch
real violations no other tool catches today.

This track winds down the framework experiment and ships the three rules
as their natural form factor (an ESLint plugin), plus a public writeup of
the bench so the work is recoverable by anyone who wants to do similar
experiments later.

## Mission

Three concrete public artifacts, all inside this repo:

1. **`eslint-plugin-port-discipline`** — published to npm, lives in
   `packages/eslint-plugin/`. The three Track R rules ported to the ESLint
   plugin API.
2. **A PR (or documented decline) to CodelyTV's
   `eslint-plugin-hexagonal-architecture`** — those three rules offered
   upstream as an extension of an existing 317-star plugin.
3. **A rewritten top-level `README.md`** that doubles as the public
   writeup of the bench: methodology, results, what didn't work, what
   we're shipping.

Everything else in this repo (CLI, plugin-typescript, plugin-python,
LSP server, MCP server, VS Code extension, telemetry, github-action) is
preserved as historical artifacts but marked deprecated. Track 3 / Track
4 / Track 5 / Track 6 of the master plan stay paused indefinitely — they
were predicated on chemag-the-framework being the right shape.

## Sequencing

```
WP-S01 (decisions, ADR-0007)
   │
   ▼
WP-S02 (build ESLint plugin) ─────┬─→ WP-S03 (validate on bench fixtures)
                                  │
                                  └─→ WP-S05 (rewrite top-level README)  ◄─ parallelizable with S02
                                  │
                                  ▼
                              WP-S04 (deprecate framework packages)
                                  │
                                  ▼
                              WP-S06 (CodelyTV contribution discussion + PRs)
                                  │
                                  ▼
                              WP-S07 (launch — publish to npm, cross-link, one round of submission)
```

---

## WP-S01 — Decisions ADR

**Track:** S
**Effort:** S (½ day)
**Blocks:** WP-S02 onwards

Three decisions to lock before any code:

1. **Which framework packages get deprecated.** Straw-man: deprecate `cli`,
   `plugin-typescript`, `plugin-python`, `lsp-server`, `mcp-server`,
   `vscode-extension`, `telemetry`, `github-action`. Keep `core` only for
   the bench fixtures the ESLint plugin reuses. Don't delete code —
   commits stay in history.
2. **ESLint plugin published name.** Recommendation: unscoped
   `eslint-plugin-port-discipline`. Unscoped names are the ESLint
   convention and discoverability is higher.
3. **README layout.** Recommendation: top-level `README.md` is the long
   writeup; `packages/eslint-plugin/README.md` is the short npm-facing
   doc with a link back up.

Output: `docs/adrs/0007-eslint-plugin-pivot.md`.

---

## WP-S02 — Build the ESLint plugin

**Track:** S
**Effort:** L (5–7 days)
**Depends on:** WP-S01

Port the three Track R rules from chemag's `checkImports`-based API to
the ESLint `RuleContext`-based API. Use `@typescript-eslint/utils` so the
rules get the TypeScript Program and `ts.TypeChecker` for free without
pulling ts-morph as a runtime dependency.

### Files to create

- `packages/eslint-plugin/package.json` — name
  `eslint-plugin-port-discipline`, peer-deps `eslint`, `typescript`,
  `@typescript-eslint/parser`.
- `packages/eslint-plugin/src/index.ts` — plugin entry exporting the
  three rules.
- `packages/eslint-plugin/src/rules/needs-interface.ts` — PORT-001
  ported.
- `packages/eslint-plugin/src/rules/no-concrete-class-import.ts` —
  PORT-003 ported. The hardest port: needs symbol resolution through
  barrel chains via `ts.TypeChecker.getAliasedSymbol`.
- `packages/eslint-plugin/src/rules/no-adapter-instantiation.ts` —
  PORT-004 ported. Auto-allowlists classes whose `extends` clause
  resolves to `Error` (fixes the false-positive noise the bench
  surfaced).
- `packages/eslint-plugin/src/utils/path-classification.ts` — converts
  rule options (`adapterPaths`, `interfacePaths`, `reactionPaths`,
  `compoundsRoot`) into role-from-path classification. Replaces
  chemag's workspace.yaml.
- `packages/eslint-plugin/src/utils/symbol-resolution.ts` — barrel
  chain walker, depth cap 5.
- `packages/eslint-plugin/test/*.test.ts` — one test file per rule.
  Each loads the existing fixtures from
  `packages/core/test/fixtures/semantic-rules/port-{001,003,004}/`
  and asserts the ESLint plugin emits the same diagnostics chemag's
  `analyzeDiagnostics` did in Track R.

### Files to modify

- Root `package.json` workspaces array — add `packages/eslint-plugin`.
- `pnpm-workspace.yaml` (if separate) — same.
- `vitest.shared.ts` — register the new package for the workspace test
  run.

### Tests

- All existing Track R fixtures pass (port-001 invalid fires, valid
  doesn't, same for 003 and 004).
- Integration: `pnpm pack` the new package into a scratch directory,
  install it into a vanilla TypeScript project, write minimal
  `.eslintrc`, verify each rule fires.

### Acceptance criteria

- [ ] All three rules export from `packages/eslint-plugin/src/index.ts`.
- [ ] Each rule has a meta block with `docs.description`,
      `docs.recommended: false`, `schema` for options.
- [ ] Plugin works in a scratch project with `npm install` (or
      `pnpm pack` + local install).
- [ ] Error-class auto-allowlist is the default in
      `no-adapter-instantiation`; opt-out via rule option
      `allowErrorSubclasses: false`.
- [ ] No runtime ts-morph dependency in the published package.

---

## WP-S03 — Validate against the bench runs

**Track:** S
**Effort:** S (1 day)
**Depends on:** WP-S02

Run the new plugin against the four final-state bench repos
(`spend-tracker-bench/runs/{control,treatment}-{1,2}/`). Compare its
output to `chemag analyze` from Gate-1 (run-2). Should match modulo the
Error-class allowlist difference.

### Output

- A table in the eventual top-level README:

| Pane | chemag analyze (run-2) | eslint-plugin-port-discipline (this work) |
|---|---|---|
| treatment-1 | 0 | 0 |
| treatment-2 | 0 | 0 |
| control-1 | 7 PORT-004, 11 BOND-003 | 0–1 PORT-004 (Error allowlist), 11 BOND would surface via existing tooling not us |
| control-2 | 8 PORT-004, 10 BOND-003 | 0–1 PORT-004, same |

The control PORT-004 hits should drop from 7-8 to 0-1 once Error
subclasses are allowlisted by default — confirming the fix.

### Acceptance criteria

- [ ] All four bench repos run through the plugin without crashes.
- [ ] The numbers go into the README's "what we shipped" section.
- [ ] Any unexpected discrepancy from chemag analyze is debugged before
      WP-S05's writeup mentions the data.

---

## WP-S04 — Deprecate framework packages

**Track:** S
**Effort:** S (1 day)
**Depends on:** WP-S02 (so deprecation can point users to the new
plugin)

Per-package one-paragraph deprecation header in each
`packages/<name>/README.md`, plus `"deprecated": "<reason>"` field in
each `package.json` (npm shows this on install). Don't delete code.

Affected packages:
- `packages/cli` — `chemag` CLI
- `packages/plugin-typescript`
- `packages/plugin-python`
- `packages/plugin-go`
- `packages/lsp-server`
- `packages/mcp-server`
- `packages/vscode-extension`
- `packages/telemetry`
- `packages/github-action`

`packages/core` stays (the ESLint plugin imports its types and fixtures).

### Acceptance criteria

- [ ] Each deprecated package's `package.json` has the `deprecated`
      field.
- [ ] Each deprecated package's `README.md` opens with a clear "this
      package is deprecated; see top-level README for what we shipped"
      paragraph.
- [ ] `pnpm install <deprecated-pkg>` (anywhere) surfaces the
      deprecation warning.
- [ ] Existing tests in deprecated packages stay green so the repo
      remains buildable. Track-R commits in those packages are not
      reverted.

---

## WP-S05 — Rewrite top-level README

**Track:** S
**Effort:** M (3–5 days, can run parallel with WP-S02)
**Depends on:** the bench data already in
`spend-tracker-bench/results/`

The load-bearing piece. The constraint from the operator is "technical,
honest, don't make it sound AI-written."

Draft outline:

```
# chem-agnostic

[1-paragraph blunt summary]

## Quick start
[3 lines of bash for the ESLint plugin]

## The three rules
[Per rule: what it catches, example, why prose alone misses it]

## Why these rules
[Pointer to the bench]

## The bench
[Methodology, run-1, Track R, run-2, the verdict]

## What didn't work
[The framework hypothesis. T1's God-file. Honest retro.]

## Status of everything else in this repo
[Per deprecated package: one paragraph]

## Related work
[CodelyTV's plugin, the existing skills, Bardia's standards]

## License + author
```

### Acceptance criteria

- [ ] ~2500–3500 words.
- [ ] Composite score table from Gate-1 embedded directly (not just
      linked).
- [ ] Concrete file paths cited in the "what didn't work" section
      (specifically the 551-line T1 catalyst).
- [ ] No filler phrases ("it's worth noting", "in conclusion", "delve
      into"). Operator reviews the draft before publish.
- [ ] Links to `spend-tracker-bench/results/VERDICT.md` and `GATE-1.md`
      both work.
- [ ] Links to CodelyTV's plugin, Bardia's standards, the
      architecture-patterns skill, and the muthu.co article.

---

## WP-S06 — CodelyTV contribution

**Track:** S
**Effort:** M (2–3 days, includes wait-for-response)
**Depends on:** WP-S02 (need the rules working), ideally WP-S07 (so
they can see the rules published)

1. Open a Discussion in
   [`CodelyTV/eslint-plugin-hexagonal-architecture`](https://github.com/CodelyTV/eslint-plugin-hexagonal-architecture/discussions).
   Subject: *"Three port-discipline rules — interested in contribution?"*
   Reference our published plugin. Two-week response window.
2. If accepted: open three small PRs, one per rule, matching their
   code style. Reference our fixtures, copy them in, adapt their
   ESLint rule API conventions.
3. If declined or no response: note it in the top-level README under
   "Related work."

### Acceptance criteria

- [ ] Discussion opened with concrete examples.
- [ ] Outcome captured in writing (either merged PR links, or a closed
      discussion link, or a "no response after 14 days" note).
- [ ] Either way, the top-level README mentions the attempt and result.

---

## WP-S07 — Launch

**Track:** S
**Effort:** S (1 day)
**Depends on:** WP-S05, WP-S04, WP-S02 done. WP-S06 can be in-flight.

1. `npm publish` the ESLint plugin.
2. Push the rewritten README to `main`.
3. Tag a v1.0.0 release on the repo. Release notes summarize the pivot.
4. Submit to one or two communities (Hacker News, /r/typescript). One
   round only.
5. Update GitHub repo description: was "Language-Agnostic Chem
   Architecture Toolkit", becomes something honest like "Three TypeScript
   ESLint rules + the bench that produced them".

### Acceptance criteria

- [ ] Package visible on npm with correct README.
- [ ] Repo's About section reflects the new identity.
- [ ] At least one community submission.
- [ ] No follow-up grinding. If it lands, deal with that when it happens.

---

## Total Track S effort

| WP | Effort | Notes |
|---|---|---|
| S01 | S | Decisions ADR |
| S02 | L | Port three rules to ESLint API |
| S03 | S | Validate on bench repos |
| S04 | S | Deprecate framework packages |
| S05 | M | Top-level README (4 days of writing) |
| S06 | M | CodelyTV PRs (includes 2-week wait window) |
| S07 | S | Launch |

**~16 days focused, 3–4 weeks at part-time pace.** S02 and S05 can
overlap.

## What this track deliberately does NOT include

- New chemag rules beyond PORT-001/003/004 (R02-R04's work)
- Migration tooling for chemag users — there are none besides the
  operator
- Documentation site
- Maintenance commitments — the plugin ships as a focused side artifact,
  not a flagship project
- Gate-2 bench re-run (Track R is closed regardless; Gate-1's verdict
  was already informative)
- Track 3 / 4 / 5 / 6 — stay paused indefinitely. The master plan as a
  whole is closed once Track S ships.
