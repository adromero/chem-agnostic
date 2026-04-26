# ADR 0001 — Monorepo toolchain

- Status: Accepted
- Date: 2026-04-25
- Stage: WP-001

## Context

The repository was a single npm package (`chem-ag`) with `src/`, `plugins/typescript/`, and `plugins/python/` co-located. The product roadmap (see `docs/master-plan/`) requires:

- A separately publishable CLI, core engine, and language plugins.
- A non-publishable workspace root that holds tooling and shared config.
- Independently versionable add-ons (MCP server, GitHub Action, telemetry, future cloud apps and websites).
- Cross-package builds with cache reuse on CI.

A flat single-package layout cannot satisfy any of those without ad-hoc workarounds.

## Decision

We convert the repo into a pnpm 9 + Turborepo 2 monorepo, rooted at this directory, with the following choices:

| Concern | Tool | Rationale |
|---|---|---|
| Package manager | **pnpm 9** | Workspaces, deterministic installs via `pnpm-lock.yaml`, fast, lower disk usage. |
| Task runner | **Turborepo 2** | Topology-aware caching for `lint`, `typecheck`, `test`, `build`. |
| Lint + format | **Biome 1.9** | Single binary; replaces ESLint + Prettier. |
| Test runner | **Vitest 3** | Already in use. Native ESM, fast watch mode. Source-mode tests via vite alias map. |
| TypeScript | **5.7+** | Project references for incremental builds across packages. |
| Versioning + changelog | **Changesets** | Per-package semver bumps, auto-generated changelog, GitHub PR-based release flow. |
| Node target | **22 LTS** | Pinned via `.nvmrc`. |

Initial workspace members (under `packages/`):

- `@chemag/cli` — was `src/` + `bin/chem-ag`. Now `packages/cli/`.
- `@chemag/core` — was `src/{types,plugin-interface,checks,import-check,loader,graph,scaffold,sync,template-claude-md}.ts`.
- `@chemag/plugin-typescript` — was `plugins/typescript/`.
- `@chemag/plugin-python` — was `plugins/python/`.
- `@chemag/telemetry` — placeholder; wired up in WP-006.

Future packages (`mcp-server`, `vscode-extension`, `github-action`, `benchmark-harness`, `rule-pack-sdk`, `plugin-go`, etc.) and `apps/` (`cloud-api`, `cloud-web`, `marketing`, `docs-site`) join the workspace as later WPs ship.

## Public binary rename

The CLI binary is renamed to `chemag` (canonical). `chem-ag` remains as a `bin` alias for backwards compatibility through the v1.x line. The alias may be removed in v2.x with a deprecation cycle.

## TypeScript module boundaries

Inter-package imports use the `@chemag/<pkg>` package name (and subpath exports for `@chemag/core`, e.g. `@chemag/core/types`). Direct relative imports across package boundaries are forbidden — Biome and the import-check engine will enforce this in later stages.

Within a package, relative imports are required (`./loader.js` etc.) so package-internal refactors do not show up as breaking changes for consumers.

## Test execution model

Tests run against the source files (not `dist/`) via vitest's vite-alias machinery (see `vitest.shared.ts`). This keeps the inner loop fast — no build step required to iterate on tests — and matches what consumers will see at type level via the package-name imports.

## Retired artifacts

The following artifacts were retired during this stage and **will not** ship in any package:

- `plugins/python/parse_imports.py` — the Python plugin used to shell out to a Python script to parse imports. The previous WP rewrote `plugins/python/parser.ts` to a pure-TypeScript tokenizer/AST. The script is now unreachable from runtime code and was deleted with `git rm`. The retired path is checked by `test/monorepo/structure.test.ts` to prevent accidental reintroduction.
- The legacy root `tsconfig.json`, `tsconfig.build.json`, root `vitest.config.ts`, root `node_modules/`, root `dist/`, root `package-lock.json`, and the self-installed `lib/node_modules/chem-ag/` symlink farm — all replaced by per-package equivalents under `packages/<pkg>/`.

## Consequences

Positive:

- Independent release cadence per package.
- Cached builds cut CI time roughly in half once the cache warms.
- Source-of-truth boundaries enforced by package names.
- Adding new packages (Go plugin, MCP server, cloud apps) is an isolated, mechanical change.

Negative / costs:

- Contributors need pnpm 9 installed (corepack handles this).
- Local IDEs that don't understand TypeScript project references may need a one-time refresh after the conversion.
- The first `pnpm install` is slower than the previous `npm install` because of the workspace topology (warmed installs are faster).

## Alternatives considered

- **Lerna**: superseded by Changesets + Turborepo for our use case. No reason to add a third tool.
- **Nx**: more powerful caching and codegen, but heavier learning curve and a stronger opinion than we need at this size.
- **npm workspaces**: works, but slower installs and less deterministic than pnpm.
- **Bun workspaces**: tempting, but Node 22 + pnpm gives us better tooling parity with downstream consumers.

## Follow-ups

- WP-002 wires the vocabulary system into `@chemag/core`.
- WP-006 replaces the `@chemag/telemetry` stub with a real implementation.
- WP-021 adds `@chemag/plugin-go`, which reuses the same package layout.
- WP-028 introduces the first `apps/` member (`cloud-api`).
