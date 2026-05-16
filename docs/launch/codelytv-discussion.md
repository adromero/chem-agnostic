# Three port-discipline rules — interested in contribution?

Hi CodelyTV team,

I've been running a small benchmark on hexagonal-architecture coaching for
LLM agents (the writeup is at
https://github.com/adromero/chem-agnostic). One of the things the bench
surfaced is that three semantic checks catch boundary violations that
TypeScript and existing ESLint rules don't:

1. **`needs-interface`** — flags a feature folder that has a concrete
   adapter (and a reaction layer) but no interface in between. Encourages
   the boring "extract a port" refactor before things spread.

   ```ts
   // ❌ src/compounds/vendors/adapters/store.ts
   //    + src/compounds/vendors/reactions/handlers.ts
   //    + (no src/compounds/vendors/interfaces/*)
   // Diagnostic: Compound 'vendors' has adapter(s) but no interface.
   ```

2. **`no-concrete-class-import`** — flags reactions/adapters that import
   a `class` declaration from another compound's public surface. Forces
   them to import the `interface` instead. Resolves through barrel
   re-exports up to a depth cap of 5.

   ```ts
   // ❌ src/compounds/orders/reactions/useStore.ts
   import { VendorRepository } from "../../vendors/public";
   // → VendorRepository is a class in vendors/adapters/, not an interface.
   ```

3. **`no-adapter-instantiation`** — flags `new SomeAdapter()` outside a
   catalyst (composition root). Auto-allowlists classes that transitively
   extend `Error` so `throw new FooError()` doesn't false-fire.

   ```ts
   // ❌ src/compounds/vendors/reactions/handlers.ts
   const r = new VendorRepository(); // outside catalyst
   ```

These currently ship as a standalone plugin
(`eslint-plugin-port-discipline` on npm), but they overlap heavily with
what your `eslint-plugin-hexagonal-architecture` covers. Rather than
maintain a competing plugin, I'd rather:

- Open three small PRs that port one rule each into your plugin, OR
- Adapt the rules to fit your existing structure if you'd prefer that.

A few questions before we proceed:

- Do you accept contributions of this size? Anything in your
  `CONTRIBUTING.md` I should follow that isn't obvious from the README?
- Would you prefer separate small PRs (one per rule) or a single larger
  one?
- Do you want me to mirror your existing rule conventions for
  meta/schema/messages, or use what I have and refactor in review?

Happy to wait for guidance. I'll keep the standalone plugin alive until
the upstream version is published either way.

Background context: the bench is mostly a writeup of a negative result
(a framework around these rules didn't beat plain prose), so this is
the small useful artifact left over. Full details:
https://github.com/adromero/chem-agnostic
