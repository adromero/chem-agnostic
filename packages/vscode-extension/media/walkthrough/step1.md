# Step 1 — What is chemag?

`chemag` describes your codebase as a small graph of **compounds** that
contain **units** and connect through **bonds**.

- **Compound** — a folder of related code (think: a feature, a service, a
  domain). Declared by a `compound.yaml` manifest.
- **Unit** — a single file that plays a role inside its compound (e.g.
  `controller`, `service`, `repository`). Roles are declared by the
  compound type.
- **Bond** — an allowed dependency between two compounds. If compound `a`
  has a bond to compound `b`, files in `a` may import from `b`'s public
  surface. Anything else is a violation.

The `workspace.yaml` at the root of your project lists the compounds, the
allowed bonds, and any compound-type rules. The chemag VS Code extension
reads that file, runs the `@chemag/core` engine over your source, and
surfaces violations inline in the editor and in the Problems panel.

Once you understand those three nouns — compound, unit, bond — you know
the whole vocabulary.

Continue to step 2 to point chemag at a real workspace.
