# chemag

Language-agnostic architecture enforcement for chemistry-inspired software design.

`chemag` (binary: `chemag`, alias `chem-ag`) extracts the core architectural engine from [chem](https://github.com/adromero/chem) (TypeScript-only) into a plugin-based system that supports multiple languages. It ships with built-in TypeScript and Python plugins.

## What is Chem?

Chem is a software architecture pattern where code is organized into **compounds** (feature modules) containing **units** (source files with assigned roles). Roles determine dependency rules called **bonds** — for example, an `element` can only depend on other elements, and a `reaction` can depend on elements, molecules, and interfaces but never on adapters.

These rules are declared in YAML manifests and enforced by analyzing real source imports.

| Role | Purpose |
|------|---------|
| **element** | Immutable value objects |
| **molecule** | Domain state composed of elements/molecules |
| **reaction** | Workflows that orchestrate through interfaces |
| **interface** | Contracts / ports |
| **adapter** | Concrete implementations of interfaces |
| **buffer** | Middleware wrapping reactions |

## Install

```bash
npm install -g @chemag/cli
```

The package installs two binaries: `chemag` (canonical) and `chem-ag` (alias for backwards compatibility).

Or from source:

```bash
git clone https://github.com/adromero/chem-agnostic.git
cd chem-agnostic
pnpm install
pnpm build
pnpm --filter @chemag/cli link --global
```

## Usage

### Initialize a workspace

```bash
chemag init myapp                        # TypeScript (default)
chemag init myapp --language python      # Python
```

### Add compounds and units

```bash
chemag add compound orders
chemag add unit orders element OrderId --export
chemag add unit orders molecule Order --export
chemag add unit orders interface OrderRepo --export
chemag add unit orders adapter PgOrderRepo --implements OrderRepo
chemag add unit orders reaction createOrder --export
```

### Validate and analyze

```bash
chemag check workspace.yaml      # Validate manifests and file structure
chemag analyze workspace.yaml    # Check real imports against bond rules
chemag scaffold workspace.yaml   # Generate stub files from manifests
chemag graph workspace.yaml      # Output Mermaid dependency diagram
chemag sync workspace.yaml       # Generate manifests from existing code
```

The `chem-ag` alias works for every command — call it with whichever name you prefer.

### Emitting AI rule files

`chemag emit-rules` synthesizes compact rule files (≤80 lines each) for every popular AI editor / agent framework. Each file is wrapped in `<!-- chemag:rules:start -->` / `<!-- chemag:rules:end -->` markers so manual content outside the block survives re-runs.

```bash
chemag emit-rules                          # write all six files
chemag emit-rules --tool claude            # one tool
chemag emit-rules --tool codex             # alias for AGENTS.md
chemag emit-rules --include-violations     # embed current diagnostics as fix-me hints
chemag emit-rules --dry-run                # print planned actions
chemag emit-rules --diff                   # show unified diff per file
chemag emit-rules --overwrite              # replace files that lack chemag markers
```

Generated files: `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/architecture.mdc`, `.github/copilot-instructions.md`, `.aider/CONVENTIONS.md`, `.clinerules`.

### MCP server

`chemag mcp` boots a [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes chemag's check / analyze / scaffold tooling to MCP-aware clients (Claude Desktop, Cursor, IDE plugins). The current scaffold registers the capability surface (tools, resources, prompts) and the initialize handshake; concrete tool handlers ship in subsequent work packages.

```bash
chemag mcp --workspace /path/to/repo                 # stdio transport (default)
chemag mcp --workspace /path/to/repo --transport stdio
```

Add the server to Claude Code or Claude Desktop:

```bash
claude mcp add chemag chemag mcp --workspace /path/to/repo
```

For a manual smoke check the official [MCP Inspector](https://github.com/modelcontextprotocol/inspector) works:

```bash
npx @modelcontextprotocol/inspector chemag mcp --workspace /path/to/repo
```

The server intentionally does **not** emit telemetry per tool call. Only the CLI's `chemag mcp` startup may emit a single (opt-in) telemetry event. SSE/HTTP transport is reserved for v1.0.x.

## Plugin System

`chemag` uses a 16-member `LanguagePlugin` interface covering:

- **Import parsing** — ts-morph for TypeScript, a hand-rolled tokenizer for Python (no subprocess required)
- **Stub generation** — language-idiomatic templates for all 6 roles
- **Public surface** — `public.ts` (TS) or `__init__.py` (Python)
- **Module resolution** — filesystem-based path resolution per language
- **File naming** — PascalCase for TS, snake_case for Python
- **CLAUDE.md generation** — language-specific architecture docs for AI assistants

### TypeScript Plugin (`@chemag/plugin-typescript`)

- Uses ts-morph for AST-based import analysis
- Generates classes, interfaces, and functions per role
- Barrel file (`public.ts`) with `export type` for interfaces

### Python Plugin (`@chemag/plugin-python`)

- Pure-TypeScript Python import parser (no Python subprocess at runtime)
- Generates `@dataclass`, `ABC`, and `async def` stubs per role
- `__init__.py` with re-exports as public surface
- Django-style snake_case file naming (`HTTPServer` -> `http_server.py`)
- `TYPE_CHECKING` guard detection
- The `inferImplements` helper still shells out to `python3` to inspect class bases — this is the only remaining Python subprocess in the plugin and is opt-in (controlled by the `CHEM_PYTHON` env var).

## Vocabulary

`chemag` ships two locales for all user-visible text (diagnostic messages, help blurbs, generated CLAUDE.md): **`standard`** (default; uses domain-driven-design terms like "use-case", "port", "dependency rule") and **`chemistry`** (the original chem metaphor: "reaction", "interface", "bond"). Pick a vocabulary three ways, in this precedence order:

1. CLI flag: `chemag check --vocabulary chemistry workspace.yaml`
2. Env var: `CHEMAG_VOCABULARY=chemistry chemag check workspace.yaml`
3. `workspace.yaml` field: `vocabulary: chemistry`

The default is `standard`. The flag and env var win over the workspace field. Adding a new translation key without entries in both locale JSON files will fail CI.

**Limitation:** per-command `--help` text uses Phase-1 vocabulary only (flag, env, or default). Workspace-sourced vocabulary is not applied to help text because help exits before any `workspace.yaml` is loaded.

## Configuration

Each workspace has a `workspace.yaml` with a `language` field:

```yaml
name: myapp
version: "1.0"
language: python
rules:
  public_surface: __init__.py
  python_packages:
    - myapp
compounds:
  - path: src/compounds/orders
    type: compound
```

## Development

```bash
pnpm install           # Install workspace dependencies
pnpm typecheck         # Run tsc --noEmit across every package
pnpm test              # Run vitest across every package + the root structure tests
pnpm build             # Compile every package to its dist/
pnpm lint              # Biome lint + format check
pnpm format            # Biome format --write
```

## Repository layout

This repo is a pnpm + Turborepo monorepo:

```
packages/
  cli/                 @chemag/cli — the chemag binary
  core/                @chemag/core — shared engine (types, loader, checks, cache, ...)
  mcp-server/          @chemag/mcp-server — Model Context Protocol server
  plugin-typescript/   @chemag/plugin-typescript
  plugin-python/       @chemag/plugin-python
  telemetry/           @chemag/telemetry (placeholder; WP-006)
docs/
  master-plan/         Implementation roadmap (60 work packages)
  adrs/                Architecture decision records
scripts/
  check-prereqs.ts     CI gate for operator-provisioned external services
```

See `docs/adrs/0001-monorepo-toolchain.md` for the full toolchain rationale.

## License

MIT
