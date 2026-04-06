# chem-ag — Language-Agnostic Chem Architecture Toolkit

A CLI tool for analyzing, scaffolding, and validating chemistry-inspired software architectures. Supports TypeScript and Python via a plugin system.

## Project Structure

```
src/               Core logic and CLI commands
  cli.ts           Entry point — command routing
  types.ts         Shared type definitions (Workspace, Compound, etc.)
  plugin-interface.ts  LanguagePlugin interface
  plugin-loader.ts     Language plugin resolver
  loader.ts        Workspace and compound manifest loader
  checks.ts        15 manifest/filesystem validation checks
  graph.ts         Mermaid diagram generator
  import-check.ts  Bond rule enforcement via real import analysis
  scaffold.ts      Stub file generation from manifests
  sync.ts          Manifest generation from existing code
  template-claude-md.ts  CLAUDE.md generator (core + plugin sections)
  cmd-*.ts         Command implementations (init, add, check, analyze, scaffold, graph, sync)
plugins/
  typescript/      TypeScript plugin (ts-morph parser, generator)
  python/          Python plugin (AST-based parser via parse_imports.py, generator)
test/              Unit tests (vitest)
  e2e/             End-to-end workflow tests
```

## Development

```bash
npm install          # Install dependencies
npm run check        # TypeScript type checking (no emit)
npm test             # Run all tests (vitest)
npm run build        # Build to dist/ (TypeScript compilation + copy parse_imports.py)
npm link             # Install chem-ag globally for testing
```

## Architecture

The tool uses a **plugin architecture** for language support. The `LanguagePlugin` interface (`src/plugin-interface.ts`) defines all language-specific operations:

- Import parsing (batch and single-file)
- Module path resolution
- Stub code generation (per role)
- Public surface generation
- File naming conventions
- Unit inference from existing code

Currently two plugins exist: **typescript** (using ts-morph) and **python** (using a Python AST subprocess).

## Key Design Decisions

- Commands call `process.exit()` for error handling. Tests mock `process.exit` to capture exit codes.
- The Python plugin shells out to `python3` for import parsing (`parse_imports.py`). The `CHEM_PYTHON` env var overrides the interpreter path.
- Bond rules and compound type rules are defined in `workspace.yaml` and enforced by `checks.ts` (manifest-level) and `import-check.ts` (source-level).
- `ts-morph` is a devDependency because it's only needed at analysis time, not at runtime in published packages.

## Testing

```bash
npm test                          # All tests
npx vitest run test/e2e/          # E2E tests only
npx vitest run test/checks.test.ts  # Specific test file
```

Tests create temp directories, run commands, and verify filesystem state. Python E2E tests are gated behind `python3` availability.
