# chem-agnostic

This repo started as a framework experiment — a language-agnostic enforcement layer for chemistry-inspired software architecture, wrapping TypeScript and Python codebases with manifests, bond rules, and AI editor hooks. That experiment ran two controlled bench studies against prose-only controls. The framework lost both times on architectural quality, though the *rules themselves* worked. So the framework is being wound down, and the three rules that caught real violations are being shipped as a standalone ESLint plugin: `eslint-plugin-port-discipline`. The rest of this repository is preserved as history. The bench writeup is below.

---

## Quick start

```bash
npm install --save-dev eslint-plugin-port-discipline \
  @typescript-eslint/parser eslint typescript
```

Minimal `eslint.config.js` (ESLint v9 flat config required):

```js
import portDiscipline from "eslint-plugin-port-discipline";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./tsconfig.json" },
    },
    plugins: { "port-discipline": portDiscipline },
    rules: {
      "port-discipline/needs-interface": [
        "error",
        { compoundsRoot: "src/compounds" },
      ],
      "port-discipline/no-concrete-class-import": [
        "error",
        { compoundsRoot: "src/compounds" },
      ],
      "port-discipline/no-adapter-instantiation": [
        "error",
        { compoundsRoot: "src/compounds" },
      ],
    },
  },
];
```

The plugin expects compounds laid out as `compoundsRoot/<compound>/<role>/*.ts`, with `<role>` ∈ `{adapters, interfaces, reactions, catalysts}` by default (override via `adapterPaths`, `interfacePaths`, `reactionPaths` options).

---

## The three rules

These rules were built in Track R in response to the bench showing that structural enforcement (file placement + import routing) did not catch the architectural failures that mattered. They operate on the TypeScript Program via `@typescript-eslint/utils`, not on file paths.

### needs-interface (PORT-001)

Fires when a compound contains at least one reaction unit and at least one I/O-using adapter unit but no interface (port) file.

Example — this structure fires the diagnostic:

```
vendors/
  handlers.ts        # role: reaction
  store.ts           # role: adapter — imports better-sqlite3
  (no store-port.ts)
```

Without an interface, the reaction depends on the concrete adapter. Prose alone won't catch this: a coding agent that reads "use ports and adapters" often skips writing the interface when nothing enforces its presence. chemag's original structural rules (`CHEM-PLACEMENT-003`, `CHEM-BOND-003`) didn't check for it either — they verified *where* files live and *which roles can import which*, not whether the port abstraction exists at all.

### no-concrete-class-import (PORT-003)

Fires when a file in compound A imports a symbol from compound B's public surface and that symbol resolves — through any number of barrel re-exports — to a `class` declaration rather than an `interface` or `type`.

The key implementation detail is barrel-chain resolution: the rule walks the export chain depth-first (up to depth 5 via `ts.TypeChecker.getAliasedSymbol`) to reach the canonical declaration. This catches the pattern the bench treatment agents relied on: re-exporting a concrete class through `public.ts` so it appears in the public surface but is still a class at the end of the chain.

Reagent-compound exports are exempt (value-object classes like `Money` or `Date` cross compound boundaries legitimately). Test files are exempt. The `import_class_allowlist` option covers additional known-safe class names.

### no-adapter-instantiation (PORT-004)

Fires when a `new XAdapter()` expression appears outside the catalyst compound, where the constructor's declaration is in a file with role `adapter`.

The catalyst is the sole composition root — the place where concrete adapters are instantiated and injected through interfaces. Instantiation of adapters anywhere else signals the composition root is fragmenting. The bench control runs had 7–8 of these violations; treatment runs had zero (chemag's `allowed_roles` constraint routes adapter construction through the catalyst).

The rule auto-allowlists classes whose `extends` clause resolves to `Error`. This addresses the false-positive noise the bench surfaced: error classes like `NotFoundError` or `ValidationError` extend `Error`, are stateless, and appear in `new` expressions throughout handler code legitimately. The `allowErrorSubclasses: false` option disables the allowlist if needed.

---

## Why these rules

The bench showed that prose-only architectural guidance (well-written CLAUDE.md with explicit port/adapter patterns) produces better subjective architectural quality than the chemag framework, *but* the control runs consistently violated PORT-001, PORT-003, and PORT-004 as measured by the new Track R rules. Those violations are the architectural failures the blinded reviewers didn't penalize because they weren't asked to check for them explicitly — but they represent real coupling that matters when a codebase scales.

The three rules fill that gap. They are precise, have low false-positive rates when configured correctly, and catch violations that neither static type analysis nor prose guidance addresses today.

Full bench methodology and results follow.

---

## The bench

### Methodology

The spend-tracker bench (`spend-tracker-bench/`) ran a controlled experiment: build the same greenfield project (a personal spend tracker with categories, CSV import, and a basic reporting screen) four times — twice with chemag enforced (treatment arm), twice with prose CLAUDE.md only (control arm). Each run used a fresh Claude Code session with the same 12 prompts in sequence.

The rubric was pre-registered and locked before run-1. It mixes mechanical diagnostics with a blinded subjective review:

| Weight | Metric |
|--------|--------|
| 25% | `chemag check` violations (excl. PLACEMENT-003 artifact) |
| 15% | `CHEM-BOND-*` violations |
| 15% | `CHEM-IMPORT-004` public surface violations |
| 10% | Role correctness (10 sampled files) |
| 5%  | Test pass rate |
| 30% | Blinded subjective review (4 axes, fresh Sonnet reviewer per pair) |

The subjective review is an independent Sonnet session, blinded to which run is treatment vs control, scoring on: module boundary clarity, anti-spaghetti, extensibility, and code quality (each 1–5, normalized to 0–1).

Pre-registered decision rubric:

| Condition | Decision |
|---|---|
| Δ ≥ 0.15 **and** 0 `CHEM-BOND-*` across both treatment runs | **Strong yes** |
| 0.05 ≤ Δ < 0.15 **and** treatment has fewer mean violations | **Weak yes** |
| \|Δ\| < 0.05 | **Null** |
| Δ < −0.05, **or** treatment scores worse on subjective than control | **Negative** |

The OR clause on the last row is the critical safeguard: even if chemag wins mechanically, a treatment-worse-on-subjective result triggers Negative regardless.

### Run-1 results

Full results: [`spend-tracker-bench/results/VERDICT.md`](../spend-tracker-bench/results/VERDICT.md)

The composite delta was +0.075 — mathematically a weak yes. But both blinded reviewers independently scored control higher than treatment on every one of the four subjective axes. Subjective delta: −0.25 (control ahead by 0.25 on a 0–1 scale). The Negative OR-clause triggered.

The reviewers' core finding was blunt: treatment agents produced code that was structurally compliant with chemag's rules but architecturally weaker than the control runs. The most illustrative failure was how agents responded to a bond violation (`reaction → reaction`). The correct fix is to extract a port interface and depend on that. The actual fix agents took was to split the compound in two, so the import becomes cross-compound through `public.ts` — mechanically clean, architecturally worse. Treatment-1 ended with 23 compounds (up from 6 entity compounds at the start). Control had 8. The extra 15 compounds contained concrete classes re-exported through barrels, not ports.

The finding in one sentence: chemag enforced structural compliance, not architectural quality.

Two paths forward: add semantic rules that catch what the structural rules miss, or reframe the value proposition. Track R chose the first path.

### Track R intervention

Track R shipped four semantic rules, all in response to the specific failure modes the run-1 reviewers flagged:

- **PORT-001** (`CHEM-PORT-001`): compound with I/O adapter and reactions must have an interface. Catches the missing port file directly.
- **PORT-003** (`CHEM-PORT-003`): cross-compound imports of class declarations through barrel chains. Catches the "re-export the concrete class" workaround.
- **PORT-004** (`CHEM-PORT-004`): adapter instantiation outside the catalyst. Catches fragmented composition roots.
- **DRY-001** (`CHEM-DRY-001`): function declarations duplicated across N+ files. Suggestions-only (not warning-level); fires with `chemag analyze --suggestions`.

DRY-001 is a suggestions-only rule — it did not fire in the bench data and does not produce hard diagnostics. It is not being ported to the initial ESLint plugin release. PORT-001, PORT-003, and PORT-004 fired on real control-arm violations and produce hard diagnostics; those are the three being shipped. For the full Track R specification and the reasoning behind DRY-001's demotion, see [`docs/master-plan/11-track-r-rule-remediation.md`](docs/master-plan/11-track-r-rule-remediation.md).

### Run-2 (Gate-1) results

Full results: [`spend-tracker-bench/results/GATE-1.md`](../spend-tracker-bench/results/GATE-1.md)

After Track R shipped (PORT-001, PORT-003, PORT-004), the bench ran again under the same protocol. Same prompts, same model, new blinded reviewers.

#### Subjective scores (blinded, axes 1–5, fresh Sonnet reviewer per pair)

| Axis | T1 | T2 | C1 | C2 |
|---|---|---|---|---|
| Module boundary clarity | 3 | 5 | 4 | 4 |
| Anti-spaghetti | 2 | 4 | 4 | 4 |
| Extensibility | 3 | 5 | 5 | 4 |
| Code quality | 3 | 4 | 4 | 5 |
| **Mean / 5 → 0–1** | **0.55** | **0.90** | **0.85** | **0.85** |

Mean(treatment subjective) = **0.725** | Mean(control subjective) = **0.850** | Subjective Δ = **−0.125**

The gap halved from run-1 (−0.25 → −0.125). Treatment-2 beat its control on subjective (0.90 vs 0.85) — the first treatment win in either bench run. Treatment-1 was still worse.

#### Mechanical metrics (after `CHEM-PLACEMENT-003` exclusion per methodology)

| Metric | T1 | T2 | C1 | C2 |
|---|---|---|---|---|
| `chemag check` violations (excl. PLACEMENT-003) | 0 | 0 | 0 | 0 |
| `CHEM-BOND-*` violations | **0** | **0** | **11** | **10** |
| `CHEM-PORT-004` (adapter instantiation) | **0** | **0** | **7** | **8** |
| `CHEM-IMPORT-004` (public surface) | 0 | 0 | 0 | 0 |
| Role correctness (10 sampled files) | 10/10 | 9/9 | 5/10 | 7/10 |
| `pnpm test` (vitest) | 174/174 | 113/113 | 205/205 | 211/211 |

PORT-004 fired 7–8 times in both control runs. PORT-003 (`CHEM-BOND-003`) fired 11 and 10 times. Both were zero in treatment. The rules work mechanically.

#### Composite — pre-registered rubric (weights locked)

| Weight | Metric | C1 | C2 | T1 | T2 |
|---|---|---|---|---|---|
| 25% | `chemag check` (excl. PLACEMENT-003) | 1.00 | 1.00 | 1.00 | 1.00 |
| 15% | `CHEM-BOND-*` | 0.00 | 0.00 | 1.00 | 1.00 |
| 15% | `CHEM-IMPORT-004` | 1.00 | 1.00 | 1.00 | 1.00 |
| 10% | Role correctness | 0.50 | 0.70 | 1.00 | 0.90 |
| 5%  | Test pass rate | 1.00 | 1.00 | 1.00 | 1.00 |
| 30% | Blinded subjective | 0.85 | 0.85 | 0.55 | 0.90 |
| | **Composite** | **0.755** | **0.775** | **0.865** | **0.960** |

Mean(treatment composite) = **0.9125** | Mean(control composite) = **0.7650** | Δ = **+0.1475**

The composite delta nearly doubled (run-1: +0.075, run-2: +0.1475). By composite-and-violations alone, this is borderline strong yes (threshold: 0.15). But mean subjective Δ = −0.125 — the "treatment scores worse on subjective" override fires. **NEGATIVE by the locked rubric.**

### Verdict

The three rules work. The framework around them does not consistently produce better-architected code than prose alone. The subjective gap narrowed but did not flip. Gate-1 is NEGATIVE.

The honest read: this is a Negative-by-letter, Weak-Yes-by-spirit result. T2 produced the cleanest codebase in either arm. T1 produced the worst. The variance is per-agent, not per-arm — the framework doesn't cause architectural wins, it just fails to prevent architectural disasters less badly than it used to.

The locked rubric was designed to catch exactly this failure mode: "mechanically compliant, subjectively worse." It triggered. Per the pre-registered protocol, productization of chemag-the-framework stays paused.

---

## What didn't work

The framework hypothesis was: if you give AI agents a structured manifest system with bond rules and hooks, they produce better-architected code than agents working from prose alone. The bench refuted that hypothesis on subjective quality — the dimension that matters most.

The specific failure in treatment-1 is the clearest illustration. The file `spend-tracker-bench/runs/treatment-1/src/catalyst/adapters/api-server.ts` is 551 lines. The reviewer's headline from the Gate-1 blind review:

> *"the single most important architectural difference is where validation, error mapping, and HTTP concerns live. In Repo X [treatment-1], the `api-server.ts` catalyst is a 551-line God file… In Repo Y [control-1], each compound owns its own `handlers.ts` and the catalyst is a 153-line wiring file."*

Why did this happen? chemag's compound-type schema constrains the `catalyst` compound to `allowed_roles: [adapter]` only. A reaction-level HTTP handler cannot live there under that constraint. So the agent either (a) puts route logic into reactions inside each compound with a thin catalyst wiring file — what T2 eventually did — or (b) shoves everything into adapter files in the catalyst compound — what T1 did. T1 chose (b). Neither PORT-001 nor PORT-004 prevents that choice, because the adapter files themselves are in the catalyst (where they belong), and the problem is *what's inside* those files, not their location.

This is a config-shape problem, not a rule-coverage problem. The fix would be reconsidering whether `catalyst.allowed_roles: [adapter]` is the right default — a `router` role type that's allowed in the catalyst would let agents write thin route-dispatch adapters without cramming HTTP logic into one 551-line file. But that's a chemag framework problem, not an ESLint rule problem.

The second failure mode — also documented in the original VERDICT — was agents responding to bond violations by splitting compounds rather than extracting interfaces. Treatment-1 went from 6 entity compounds to 23 total. Every split produced a new `public.ts` that re-exported a concrete class. The control agent, reading the same prose about ports and adapters, just wrote the interface files. No hook ever fired. The architecture is cleaner.

These failure modes point at the same root cause: chemag's enforcement was structural (file placement, import routing) and agents found structural workarounds that preserved compliance while undermining intent. The semantic rules from Track R address some of this — PORT-003 would have caught the concrete-class-through-barrel workaround. But the 551-line God-file problem requires a different approach.

---

## Status of everything else in this repo

The framework packages are deprecated. Code is not deleted — the commits are part of the story and the bench fixtures in `packages/core/test/fixtures/semantic-rules/` are reused by the ESLint plugin's tests. Full deprecation narratives (history, why it was built, why it's not the right shape now, what to use instead) live in each package's own README.

### `@chemag/cli`
Deprecated. The `chemag` binary that bootstrapped the framework experiment. See [packages/cli/README.md](packages/cli/README.md).

### `@chemag/plugin-typescript`
Deprecated. ts-morph-based TypeScript import analysis plugin for chemag. See [packages/plugin-typescript/README.md](packages/plugin-typescript/README.md).

### `@chemag/plugin-python`
Deprecated. Pure-TypeScript Python import parser and stub generator for chemag. See [packages/plugin-python/README.md](packages/plugin-python/README.md).

### `@chemag/plugin-go`
Deprecated. Go language plugin for chemag (partially implemented). See [packages/plugin-go/README.md](packages/plugin-go/README.md).

### `@chemag/lsp-server`
Deprecated. Language Server Protocol server exposing chemag diagnostics to editors. See [packages/lsp-server/README.md](packages/lsp-server/README.md).

### `@chemag/mcp-server`
Deprecated. Model Context Protocol server that exposed chemag check/analyze to Claude Desktop and Cursor. See [packages/mcp-server/README.md](packages/mcp-server/README.md).

### `@chemag/vscode-extension`
Deprecated. VS Code extension surfacing chemag diagnostics inline. See [packages/vscode-extension/README.md](packages/vscode-extension/README.md).

### `@chemag/telemetry`
Deprecated. Telemetry placeholder package (was never fully implemented). See [packages/telemetry/README.md](packages/telemetry/README.md).

### `@chemag/github-action`
Deprecated. GitHub Actions workflow wrapper for `chemag check` and `chemag analyze`. See [packages/github-action/README.md](packages/github-action/README.md).

---

## Related work

The prior-art survey that preceded the ADR-0007 pivot decision found several projects in this space. These influenced both the decision to wind down the framework and the decision to ship the rules as an ESLint plugin.

- **[CodelyTV/eslint-plugin-hexagonal-architecture](https://github.com/CodelyTV/eslint-plugin-hexagonal-architecture)** (317 stars) — the existing ESLint home for hexagonal architecture enforcement. One rule covering folder layout and cross-layer imports; less sophisticated than PORT-003/004 but widely used and actively maintained. WP-S06 is proposing the three port-discipline rules as a contribution upstream.

- **[bardiakhosravi/ai-agent-backend-standards](https://github.com/bardiakhosravi/ai-agent-backend-standards)** — 24 detailed hexagonal+DDD rules distributed as `.cursorrules`, Windsurf config, and `CLAUDE.md`. Multi-tool support out of the box. The same problem this bench studied (do architectural rules improve AI-generated code quality?) is addressed here through prose distribution rather than enforcement. Bardia's approach is lighter-weight and already multi-tool; ours produces hard ESLint diagnostics.

- **[secondsky/architecture-patterns](https://github.com/secondsky/architecture-patterns)** — a Claude Code skill that teaches Clean Architecture, Hexagonal Architecture, and DDD patterns to Claude as an on-demand capability. The approach is instruction-as-skill rather than enforcement; complementary to what `eslint-plugin-port-discipline` does.

- **"The Architecture is the Prompt"** ([muthu.co, Nov 2025](https://muthu.co/the-architecture-is-the-prompt/)) — argues that clean architecture beats elaborate prompting because the architectural structure itself enforces boundaries. The bench results are consistent with this thesis: control agents reading "write port interfaces" in prose did it; treatment agents with structural hooks found structural workarounds.

---

## Repository structure

This is a pnpm + Turborepo monorepo. The active package is `packages/eslint-plugin/` (in development). Everything else is historical.

```
packages/
  eslint-plugin/       eslint-plugin-port-discipline — the three rules (WP-S02, in progress)
  core/                @chemag/core — kept for bench fixtures and type references
  cli/                 @chemag/cli — deprecated
  plugin-typescript/   @chemag/plugin-typescript — deprecated
  plugin-python/       @chemag/plugin-python — deprecated
  plugin-go/           @chemag/plugin-go — deprecated
  lsp-server/          @chemag/lsp-server — deprecated
  mcp-server/          @chemag/mcp-server — deprecated
  vscode-extension/    @chemag/vscode-extension — deprecated
  telemetry/           @chemag/telemetry — deprecated
  github-action/       @chemag/github-action — deprecated
spend-tracker-bench/   The bench (separate directory, sibling to this repo)
docs/
  master-plan/         60-WP plan (Tracks 0–6 + Track R + Track S)
  adrs/                Architecture decision records (0001–0007)
```

The bench lives at `/spend-tracker-bench/` relative to this repo's parent directory. The `runs/` subdirectory contains the four final-state repos locked at a single commit each. They are reproducible.

---

## Building from source

```bash
pnpm install
pnpm build        # compiles all packages
pnpm test         # vitest across all packages + root structure tests
pnpm typecheck    # tsc --noEmit per package
pnpm lint         # Biome lint + format check
```

Node 22 LTS, pnpm 9 required.

---

## License + author

MIT. [A. Romero](https://github.com/adromero).

The three rules in this repo (`eslint-plugin-port-discipline`) and the bench methodology are the primary public artifacts. The framework packages are historical. Questions, issues, and PRs on the ESLint plugin are welcome; maintenance commitments on the deprecated framework packages are not.
