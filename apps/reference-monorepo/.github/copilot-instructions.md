<!-- chemag:rules:start -->
# reference-monorepo — Copilot instructions

Cross-compound imports go through the public surface (`public.ts`) only — never reach into internal files.

| Role | Can depend on |
|------|---------------|
| element | element |
| molecule | element, molecule |
| reaction | element, molecule, interface |
| interface | element, molecule |
| adapter | element, molecule, interface, adapter |
| buffer | element, molecule, interface |

Run `chemag check-edit <file>` after every edit.
<!-- chemag:rules:end -->
