# chemag — Language-Agnostic Chem Architecture Toolkit

A CLI tool for analyzing, scaffolding, and validating chemistry-inspired software architectures. Supports TypeScript and Python via a plugin system. Public binary: `chemag` (alias `chem-ag` retained for backwards compatibility).

This repo is a **pnpm + Turborepo monorepo**. See `docs/adrs/0001-monorepo-toolchain.md` for the toolchain rationale and `docs/master-plan/` for the full implementation roadmap (60 work packages).

## Project Structure

```
packages/
  cli/                       @chemag/cli — the chemag binary
    bin/chem-ag              Thin shim that loads dist/cli.js
    src/
      cli.ts                 Entry point — command routing
      plugin-loader.ts       Language plugin resolver (TS / Python today; Go in WP-021)
      commands/
        init.ts add.ts check.ts analyze.ts scaffold.ts graph.ts sync.ts
    test/                    cli + e2e tests
  core/                      @chemag/core — shared engine
    src/
      types.ts               Workspace, Compound, Diagnostic, etc.
      plugin-interface.ts    LanguagePlugin interface
      loader.ts              workspace.yaml / compound manifest loader
      checks.ts              Manifest + filesystem validation checks
      import-check.ts        Bond rule enforcement via real import analysis
      scaffold.ts            Stub file generation from manifests
      sync.ts                Manifest generation from existing code
      graph.ts               Mermaid dependency diagram
      template-claude-md.ts  CLAUDE.md generator (core + plugin sections)
      index.ts               Public barrel — also exposed via subpaths (./types, ./loader, ...)
    test/
  plugin-typescript/         @chemag/plugin-typescript — ts-morph based plugin
  plugin-python/             @chemag/plugin-python — pure-TypeScript Python parser
  telemetry/                 @chemag/telemetry — placeholder for WP-006
scripts/
  check-prereqs.ts           Validates operator-provisioned env (Cloudflare, Stripe, ...)
test/monorepo/               Asserts the workspace layout matches spec
docs/
  master-plan/               60-WP plan
  adrs/                      Architecture decision records (start with 0001)
.changeset/                  Changesets-driven release flow
.github/workflows/           CI + release workflows
```

## Development

```bash
pnpm install           # Install workspace dependencies (pnpm 9, Node 22)
pnpm typecheck         # Turbo: tsc --noEmit per package
pnpm test              # Turbo: vitest per package + root structure tests
pnpm build             # Turbo: tsc per package -> dist/
pnpm lint              # Biome lint + format check (replaces ESLint+Prettier)
pnpm format            # Biome format --write across the workspace
pnpm --filter @chemag/cli link --global   # Install the chemag binary globally
```

## Architecture

The tool uses a **plugin architecture** for language support. The `LanguagePlugin` interface (`@chemag/core/plugin-interface`) defines all language-specific operations:

- Import parsing (batch and single-file)
- Module path resolution
- Stub code generation (per role)
- Public surface generation
- File naming conventions
- Unit inference from existing code

Currently two plugins exist: **typescript** (using ts-morph) and **python** (a pure-TypeScript tokenizer/AST — see "Key Design Decisions" below).

## Key Design Decisions

- Commands call `process.exit()` for error handling. Tests mock `process.exit` to capture exit codes.
- The Python plugin parses imports entirely in TypeScript — no Python subprocess in the parsing path. The previous `parse_imports.py` artifact has been retired (see `docs/adrs/0001-monorepo-toolchain.md` § "Retired artifacts").
- The Python plugin still shells out to `python3` for `inferImplements` (resolving class bases via `ast`); the `CHEM_PYTHON` env var overrides the interpreter path. This is the only Python subprocess left in the plugin and only runs during `sync` / `add --implements` flows.
- Bond rules and compound type rules are defined in `workspace.yaml` and enforced by `checks.ts` (manifest-level) and `import-check.ts` (source-level).
- `ts-morph` lives in `@chemag/plugin-typescript` only; `@chemag/cli` and `@chemag/core` do not depend on it.
- Tests resolve `@chemag/*` to source files via vitest aliases (see `vitest.shared.ts`) — no build step required for the test inner loop.
- Inter-package imports always go through the package name (`@chemag/core/loader`, `@chemag/plugin-typescript`, ...). Direct relative imports across package boundaries are forbidden.

## Testing

```bash
pnpm test                                              # Everything
pnpm --filter @chemag/core test                        # Just the core package
pnpm --filter @chemag/cli test                         # Just the CLI (incl. e2e)
pnpm --filter @chemag/plugin-python test               # Plugin tests
pnpm test:root                                         # Just structure + check-prereqs tests
```

Tests create temp directories, run commands, and verify filesystem state. Python E2E tests are gated behind `python3` availability — they will skip cleanly on machines that don't have it.

## Publishing

Releases are driven by Changesets. Workflow:

1. After a user-visible change, run `pnpm changeset` and pick the affected packages + bump kind.
2. Commit the generated changeset alongside your PR.
3. On `main`, `release.yml` opens (or updates) a "Version Packages" PR. Merging that PR publishes every bumped package to npm with provenance.

See `.changeset/README.md` for details.
