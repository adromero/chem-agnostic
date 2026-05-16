# eslint-plugin-port-discipline

## 1.0.0

### Major Changes

Initial release. Three ESLint rules for hexagonal / ports-and-adapters
TypeScript codebases:

- `needs-interface` (PORT-001) — compounds with concrete I/O must
  declare an interface role.
- `no-concrete-class-import` (PORT-003) — adapters depend on
  interfaces, not classes from other compounds. Resolves through barrel
  re-exports up to depth 5.
- `no-adapter-instantiation` (PORT-004) — only catalysts may
  instantiate adapters from other compounds. Classes that transitively
  extend `Error` are auto-allowlisted by default; opt out with
  `allowErrorSubclasses: false`.

Requires ESLint 9 (flat config), `@typescript-eslint/parser` 8.x, and
TypeScript ≥ 4.8.4.
