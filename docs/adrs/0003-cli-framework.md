# ADR 0003 — CLI framework choice and adapter-pattern boundary

- Status: Accepted
- Date: 2026-04-26
- Stage: WP-008

## Context

Pre-WP-008 the CLI used a hand-rolled argv parser:

- Top-level help was assembled by string concatenation in `printHelp()`.
- Each `cmdXxx(argv: string[])` function had its own bespoke parser.
- No shell-completion support.
- Help text was correct but cosmetically inconsistent — different commands used different `Usage:` shapes, no command grouping, no color/box framing.

We need:

1. Cohesive top-level `--help` with command groupings (Workspace / Validation / Generation / Utilities).
2. Shell completion scripts for bash, zsh, fish.
3. A maintainable place to declare per-command argument metadata (for help + completion) without forcing a rewrite of every `cmdXxx`.
4. Eleven existing test files import `runCli` from `../src/cli.js` and drive it synchronously, spying on `process.exit` / `console.log`. That contract must be preserved.

## Decision

**Adopt `citty` as the CLI metadata framework.** Bound the integration to an **adapter pattern**: citty owns help-text rendering, completion-script generation, and argument metadata; the existing `runCli` switch keeps owning dispatch, `process.exit`, argv parsing, and global-flag stripping.

### What the framework owns

| Concern                          | Owner                                            |
| -------------------------------- | ------------------------------------------------ |
| Help-text layout                 | `cli-meta.ts` `renderHelp()` (walks citty tree)  |
| Completion-script generation     | `scripts/gen-completions.ts`                     |
| Per-command argument metadata    | `defineCommand({ args })` in `cli-meta.ts`       |
| Command descriptions             | `defineCommand({ meta.description })` from `tr()` |

### What the framework does NOT own

| Concern                          | Owner                                            |
| -------------------------------- | ------------------------------------------------ |
| Dispatch                         | `runCli(argv)` switch in `cli.ts`                |
| `process.exit` calls             | Each `cmdXxx(argv)` directly                     |
| argv parsing per command         | Each `cmdXxx(argv)` directly                     |
| Global flags resolution          | `runCli` Phases 1/1.5/1.6                        |
| Telemetry lifecycle              | `runCliBootstrap` orchestration                  |

### Why citty (vs. commander, yargs, oclif)

- **ESM-native.** The monorepo is ESM-only; citty matches the module style.
- **Lightweight.** ~10 KB, no transitive runtime cost. commander pulls in nothing extra; yargs pulls in 8+ deps; oclif is heavyweight.
- **Declarative.** `defineCommand({ meta, args })` is plain object metadata that we walk ourselves for help — no callback-driven dispatch model that fights our existing switch.
- **Built-in usage renderer.** Even though we ship our own synchronous `renderHelp` (citty's `renderUsage` is async; `runCli` must stay sync per the test contract), the meta shape is reused for completion generation and could later swap to citty's renderer if `runCli` becomes async.

### Why `runCli` stays synchronous

Eleven test files (`test/cli.test.ts`, `test/cli-no-telemetry.test.ts`, `test/check-explain.test.ts`, `test/vocabulary-e2e.test.ts`, `test/cache/cli-no-cache.test.ts`, `test/commands/analyze-formats.test.ts`, `test/commands/check-edit-formats.test.ts`, `test/commands/check-edit.test.ts`, `test/commands/check-formats.test.ts`, `test/e2e/typescript-workflow.test.ts`, `test/perf/check-edit.bench.ts`) import `runCli` and drive it synchronously, catching the thrown `__cli_exit__` from a mocked `process.exit`. Making `runCli` async would force all of those rewrites. We refuse that cost.

### Why global flags are stripped pre-dispatch

`--vocabulary <v>`, `--no-cache`, and `--no-telemetry` are resolved in `runCli` Phases 1/1.5/1.6 before any framework code runs. The citty command tree **must not** declare these as command options. Reasons:

1. They affect program-wide state (vocabulary lookup, cache flag, telemetry flag) that must be set before any command-specific code reads it.
2. They are accepted in any position relative to the subcommand: `chemag --vocabulary chemistry check` and `chemag check --vocabulary chemistry` both work. Citty's per-command parser would reject the first form.
3. They are documented as **global** flags. Listing them on every subcommand bloats the help text.

The `chemag --help` output renders these in a separate "GLOBAL FLAGS" block sourced from `renderHelp()` in `cli-meta.ts`, not from any `defineCommand` declaration.

### Effort

**Medium (M).** Bounded by:

- One new module: `cli-meta.ts` (citty declarations + renderHelp).
- One new module: `commands/completion.ts` (cmdCompletion).
- One generator: `scripts/gen-completions.ts`.
- Three new UI helpers: `ui/{colors,spinner,box}.ts`.
- Three completion script files (committed).
- Three new test files.
- Modifications to `cli.ts`: `printHelp` body swap, `completion` case in switch, try/finally telemetry flush.

Out of scope (rejected per red-team review):

- Async `cmdXxx` handlers — would force test rewrites.
- citty `run` callback driving dispatch — switch in `runCli` stays.
- Removing `cmdXxx(argv: string[])` signatures.
- Replacing the bin shim with a citty entry point.
- Global `--json` flag alias — deferred to wp-052+.

## Consequences

### Positive

- Help output is consistent and grouped.
- Shell completions ship for all three major shells.
- Per-command arg metadata is declarative and lives in one place.
- The framework choice is reversible — if citty becomes a problem, swapping to commander is a `cli-meta.ts` rewrite, not a project-wide change.

### Negative

- `cli-meta.ts` duplicates some descriptive prose from the `tr()` keys (e.g., `firstLine(tr("cli.command.init"))`). The duplication is acceptable because the source-of-truth is the `tr()` key; `cli-meta.ts` only re-projects it.
- Help-text rendering is now owned by us (not citty) because citty's `renderUsage` is async and `runCli` must stay sync. We accept the small renderer in `cli-meta.ts` as the cost of preserving the test contract.

### Drift check

`scripts/gen-completions.ts` re-runs in CI must produce byte-identical output to the committed `src/completions/*.{sh,fish}` files. The drift assertion lives in `test/completions.test.ts`.

## Future work

- WP-052+ may add a global `--json` flag.
- If `runCli` becomes async at some future stage, swap our local `renderHelp` for citty's `renderUsage` and delete the duplicate logic.
