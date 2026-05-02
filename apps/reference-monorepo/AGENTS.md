<!-- chemag:rules:start -->
# reference-monorepo — Architecture rules

This project uses **Chem**, a chemistry-inspired software architecture. Read this entire file before writing any code.

## Architecture summary
This workspace uses a bond-driven architecture. Each unit has a role; there are 6 roles in this workspace.

## Dependency rules
| Role | Can depend on |
|------|---------------|
| element | element |
| molecule | element, molecule |
| reaction | element, molecule, interface |
| interface | element, molecule |
| adapter | element, molecule, interface, adapter |
| buffer | element, molecule, interface |

## Cross-module imports
Cross-compound imports go through the public surface (`public.ts`) only — never reach into internal files.

## Validation
Validate after edits:
- `chemag check workspace.yaml` — manifest + filesystem checks
- `chemag analyze workspace.yaml` — real imports vs dependency rules
- `chemag check-edit <file>` — single-file edit validation (best for AI tools)

## Where to look
- `workspace.yaml` — global roles, dependency rules, and module-type rules
- each module's `compound.yaml` — declared units, exports, and imports
- existing modules: `audit-emit`, `audit-log`, `auth`, +18 more
<!-- chemag:rules:end -->
