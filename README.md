# chem-ag

Language-agnostic architecture enforcement for chemistry-inspired software design.

`chem-ag` extracts the core architectural engine from [chem](https://github.com/adromero/chem) (TypeScript-only) into a plugin-based system that supports multiple languages. It ships with built-in TypeScript and Python plugins.

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
npm install -g chem-ag
```

Or from source:

```bash
git clone https://github.com/adromero/chem-agnostic.git
cd chem-agnostic
npm install
npm run build
npm link
```

## Usage

### Initialize a workspace

```bash
chem-ag init myapp                        # TypeScript (default)
chem-ag init myapp --language python      # Python
```

### Add compounds and units

```bash
chem-ag add compound orders
chem-ag add unit orders element OrderId --export
chem-ag add unit orders molecule Order --export
chem-ag add unit orders interface OrderRepo --export
chem-ag add unit orders adapter PgOrderRepo --implements OrderRepo
chem-ag add unit orders reaction createOrder --export
```

### Validate and analyze

```bash
chem-ag check workspace.yaml      # Validate manifests and file structure
chem-ag analyze workspace.yaml    # Check real imports against bond rules
chem-ag scaffold workspace.yaml   # Generate stub files from manifests
chem-ag graph workspace.yaml      # Output Mermaid dependency diagram
chem-ag sync workspace.yaml       # Generate manifests from existing code
```

## Plugin System

`chem-ag` uses a 16-member `LanguagePlugin` interface covering:

- **Import parsing** — ts-morph for TypeScript, `ast.parse()` via subprocess for Python
- **Stub generation** — language-idiomatic templates for all 6 roles
- **Public surface** — `public.ts` (TS) or `__init__.py` (Python)
- **Module resolution** — filesystem-based path resolution per language
- **File naming** — PascalCase for TS, snake_case for Python
- **CLAUDE.md generation** — language-specific architecture docs for AI assistants

### TypeScript Plugin

- Uses ts-morph for AST-based import analysis
- Generates classes, interfaces, and functions per role
- Barrel file (`public.ts`) with `export type` for interfaces

### Python Plugin

- Uses `ast.parse()` via a bundled Python script (stdlib only, no pip deps)
- Generates `@dataclass`, `ABC`, and `async def` stubs per role
- `__init__.py` with re-exports as public surface
- Django-style snake_case file naming (`HTTPServer` -> `http_server.py`)
- `TYPE_CHECKING` guard detection
- Requires Python 3.10+

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
npm test          # Run all 208 tests
npm run check     # Type-check without emitting
npm run build     # Compile to dist/
```

## License

MIT
