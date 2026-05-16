# eslint-plugin-port-discipline

Three ESLint rules that catch hexagonal/ports-and-adapters violations TypeScript's type system can't.

See the top-level README for the full architecture story.

## Requirements

- **ESLint v9+ (flat config only)** — legacy `.eslintrc` / ESLint v8 is not supported.
- TypeScript >=4.8.4
- `@typescript-eslint/parser` ^8

## Install

```sh
npm install --save-dev eslint-plugin-port-discipline
```

## Rules

| Rule | Description |
|---|---|
| `port-discipline/needs-interface` | Flags adapter classes that are imported directly without a port interface. |
| `port-discipline/no-concrete-class-import` | Flags concrete class imports across compound boundaries. |
| `port-discipline/no-adapter-instantiation` | Flags `new AdapterClass()` calls in non-catalyst files. |

## Usage (ESLint v9 flat config)

```js
// eslint.config.js
import portDiscipline from 'eslint-plugin-port-discipline';

export default [
  {
    plugins: { 'port-discipline': portDiscipline },
    rules: {
      'port-discipline/needs-interface': 'error',
      'port-discipline/no-concrete-class-import': 'error',
      'port-discipline/no-adapter-instantiation': 'error',
    },
  },
];
```

> **Note:** Rule implementations are stubs until S02b/c/d. See `docs/master-plan/12-track-S-shipping.md` for the roadmap.
