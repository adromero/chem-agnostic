# r/typescript submission

## Title

`eslint-plugin-port-discipline — three rules for hexagonal boundaries (and the bench they came from)`

## Body

I published a small ESLint plugin with three rules I found useful when
working on hexagonal/ports-and-adapters codebases in TypeScript:

- **`needs-interface`** — a feature folder that has a concrete adapter
  and a reaction layer but no interface gets flagged. Easy refactor:
  extract the port.
- **`no-concrete-class-import`** — an `import { Foo } from
  '../../other/public'` where `Foo` is a class (even after walking
  barrel re-exports up to 5 hops) gets flagged. The fix is to import
  the interface and move the concrete dep to a catalyst.
- **`no-adapter-instantiation`** — `new SomeAdapter()` outside a
  catalyst gets flagged. The rule auto-allowlists classes that
  transitively extend `Error`, so `throw new FooError()` doesn't
  false-fire.

The plugin requires ESLint 9 (flat config) and uses
`@typescript-eslint/parser` for symbol resolution. Test fixtures and
docs are in the repo.

```bash
npm install --save-dev eslint-plugin-port-discipline
```

```js
// eslint.config.js
import portDiscipline from 'eslint-plugin-port-discipline';

export default [{
  files: ['src/**/*.ts'],
  plugins: { 'port-discipline': portDiscipline },
  rules: {
    'port-discipline/needs-interface': ['error', { compoundsRoot: '/abs/path/to/src/compounds' }],
    'port-discipline/no-concrete-class-import': ['error', { compoundsRoot: '/abs/path/to/src/compounds' }],
    'port-discipline/no-adapter-instantiation': ['error', { compoundsRoot: '/abs/path/to/src/compounds' }],
  },
}];
```

The interesting part of the writeup is that the rules came out of a
benchmark that failed. I was building a framework around them; the
framework lost to plain hexagonal-prose prompts in head-to-head
evaluation. The three rules survived. The repo has the bench data,
the locked rubric, and the ADR documenting the pivot.

Repo: https://github.com/adromero/chem-agnostic

Happy to answer questions about the rules, the bench, or the
methodology.
