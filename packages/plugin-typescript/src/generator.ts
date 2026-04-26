import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AssayDeclaration,
  InferredUnit,
  LoadedCompound,
  ResolvedImport,
  UnitDeclaration,
  Workspace,
} from "@chemag/core/types";

// ---------------------------------------------------------------------------
// Import rendering
// ---------------------------------------------------------------------------

/**
 * Format a TypeScript import statement.
 */
export function formatImportStatement(from: string, to: string, isTypeOnly: boolean): string {
  const kw = isTypeOnly ? "import type" : "import";
  return `${kw} { ${from} } from "${to}";`;
}

/**
 * Build import lines for a unit from its resolved imports.
 * Converts ResolvedImport[] (compound/unit identity) into renderable
 * TS import lines, merging imports from the same source.
 */
function renderImportLines(imports: ResolvedImport[]): string {
  if (imports.length === 0) return "";

  const lines = imports.map((imp) =>
    formatImportStatement(imp.names.join(", "), imp.fromCompound, imp.isTypeOnly),
  );
  return `${lines.join("\n")}\n\n`;
}

// ---------------------------------------------------------------------------
// Unit stub generation
// ---------------------------------------------------------------------------

/**
 * Generate a role-specific TypeScript stub for a unit declaration.
 */
export function generateUnitStub(unit: UnitDeclaration, imports: ResolvedImport[]): string {
  const head = renderImportLines(imports);

  switch (unit.role) {
    case "element":
      return `${head}export class ${unit.name} {\n  constructor(readonly value: string) {}\n}\n`;

    case "molecule":
      return `${head}export class ${unit.name} {\n  constructor() {\n    // TODO: implement\n  }\n}\n`;

    case "reaction":
      return `${head}export async function ${unit.name}(): Promise<void> {\n  // TODO: implement\n}\n`;

    case "interface":
      return `${head}export interface ${unit.name} {\n  // TODO: define methods\n}\n`;

    case "adapter": {
      const impl = (unit.implements ?? []).join(", ");
      const clause = impl ? ` implements ${impl}` : "";
      return `${head}export class ${unit.name}${clause} {\n  // TODO: implement\n}\n`;
    }

    case "buffer":
      return `${head}export function ${unit.name}(\n  next: () => Promise<void>,\n): Promise<void> {\n  // TODO: implement\n  return next();\n}\n`;

    default:
      return `// TODO: implement ${unit.name} (${unit.role})\n`;
  }
}

// ---------------------------------------------------------------------------
// Public surface (barrel file)
// ---------------------------------------------------------------------------

/**
 * Generate the public surface module (re-exports) for a compound.
 * Uses `export type` for interfaces.
 */
export function generatePublicSurface(compound: LoadedCompound, _workspace: Workspace): string {
  if (!compound.manifest.exports) return "";

  const lines: string[] = [];

  for (const [roleKey, names] of Object.entries(compound.manifest.exports)) {
    // Export keys are plural (e.g. "interfaces"), strip trailing 's' to get role
    const role = roleKey.replace(/s$/, "");

    for (const name of names) {
      const unit = (compound.manifest.units ?? []).find((u) => u.name === name);
      if (!unit) continue;

      let rel = unit.file.replace(/\.ts$/, "").replace(/\\/g, "/");
      if (!rel.startsWith(".")) rel = `./${rel}`;

      const kw = role === "interface" ? "export type" : "export";
      lines.push(`${kw} { ${name} } from "${rel}";`);
    }
  }

  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Assay (test) stub generation
// ---------------------------------------------------------------------------

/**
 * Generate a stub test file for a compound assay.
 */
export function generateAssayStub(assay: AssayDeclaration, compound: LoadedCompound): string {
  const assayAbs = path.resolve(compound.dir, assay.file);
  const assayDir = path.dirname(assayAbs);

  const importLines: string[] = [];
  for (const subject of assay.subjects ?? []) {
    const unit = (compound.manifest.units ?? []).find((u) => u.name === subject);
    if (!unit) continue;

    const unitAbs = path.resolve(compound.dir, unit.file);
    const rel = formatRelativeImport(assayDir, unitAbs);
    importLines.push(`import { ${subject} } from "${rel}";`);
  }

  const head = importLines.length > 0 ? `${importLines.join("\n")}\n\n` : "";
  const label = (assay.subjects ?? []).join(", ") || assay.name;

  return `${head}describe("${label}", () => {\n  it.todo("should work");\n});\n`;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/**
 * Format a relative import path between two file locations.
 * Strips .ts extension for TypeScript module specifiers.
 */
export function formatRelativeImport(fromDir: string, toFile: string): string {
  let rel = path.relative(fromDir, toFile).replace(/\\/g, "/").replace(/\.ts$/, "");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

// ---------------------------------------------------------------------------
// Inference (sync)
// ---------------------------------------------------------------------------

/**
 * Scan a role directory for TypeScript files and infer unit declarations.
 */
export function inferUnits(dir: string, roleFolder: string, role: string): InferredUnit[] {
  const roleDir = path.join(dir, roleFolder);
  if (!fs.existsSync(roleDir)) return [];

  let files: string[];
  try {
    files = fs
      .readdirSync(roleDir)
      .filter(
        (f) =>
          f.endsWith(".ts") &&
          !f.endsWith(".test.ts") &&
          !f.endsWith(".spec.ts") &&
          !f.endsWith(".d.ts"),
      );
  } catch {
    return [];
  }

  const units: InferredUnit[] = [];

  for (const file of files) {
    const name = file.replace(/\.ts$/, "");
    const filePath = path.join(roleDir, file);

    const unit: InferredUnit = {
      name,
      role,
      fileName: `./${roleFolder}/${file}`,
      exports: inferExports(filePath),
    };

    if (role === "adapter") {
      const impl = inferImplements(filePath);
      if (impl.length > 0) {
        unit.implements = impl[0];
      }
    }

    units.push(unit);
  }

  return units;
}

/**
 * Infer which interfaces a file implements by inspecting its source.
 * Looks for `implements X` or `implements X, Y` patterns.
 */
export function inferImplements(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(/implements\s+([\w\s,]+)\s*\{/);
    if (match) {
      return match[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch {
    // File doesn't exist or unreadable
  }
  return [];
}

/**
 * Infer export names from a TypeScript source file (basic heuristic).
 */
function inferExports(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const names: string[] = [];
    const exportPattern = /export\s+(?:class|interface|function|const|type|enum)\s+(\w+)/g;
    for (const match of content.matchAll(exportPattern)) {
      names.push(match[1]);
    }
    return names;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// CLAUDE.md generation
// ---------------------------------------------------------------------------

/**
 * Generate the full CLAUDE.md content for a workspace using TypeScript examples.
 */
export function generateClaudeMd(workspaceName: string): string {
  return `# ${workspaceName} — Chem Architecture

This project uses **Chem**, a chemistry-inspired software architecture. Read this entire file before writing any code.

## Core Concept

Code is organized into **compounds** (feature modules). Each compound contains **units** — source files with assigned **roles**. Roles determine what a unit can depend on. These dependency rules are called **bonds**.

Every compound has a manifest (\`compound.yaml\`) declaring its units, exports, and imports. The workspace config (\`workspace.yaml\`) defines the global rules.

**Before writing any code**: read \`workspace.yaml\`, then the target compound's \`compound.yaml\`.

## Roles — What Each Unit Type Means

| Role | What it is | Examples |
|------|-----------|----------|
| **element** | Immutable value object. The simplest building block. | \`UserId\`, \`Email\`, \`Money\`, \`DateRange\` |
| **molecule** | Domain state composed of elements/molecules. | \`UserProfile\`, \`Order\`, \`ReportDocument\` |
| **reaction** | Workflow or use case. Orchestrates state through interfaces. | \`createOrder\`, \`generateReport\`, \`processPayment\` |
| **interface** | Contract / port. Defines a capability without implementation. | \`OrderRepository\`, \`PaymentGateway\`, \`EmailSender\` |
| **adapter** | Concrete implementation of an interface. Touches the outside world. | \`PgOrderRepository\`, \`StripeGateway\`, \`SmtpEmailSender\` |
| **buffer** | Middleware. Wraps reactions for cross-cutting concerns. | \`authGuard\`, \`rateLimiter\`, \`validateInput\` |

## Decision Flowchart — Where Does New Code Go?

When adding functionality, follow this decision tree:

1. **Is it a primitive value with no dependencies?** → \`element\`
2. **Is it domain state composed of other values?** → \`molecule\`
3. **Is it a workflow that coordinates state changes?** → \`reaction\`
4. **Does it define a capability boundary (IO, external service)?** → \`interface\`
5. **Does it implement an interface with real IO?** → \`adapter\`
6. **Does it wrap a reaction (auth, logging, validation)?** → \`buffer\`

If you're unsure, start with the simplest role. You can promote later (element → molecule → reaction as complexity grows).

## Bond Rules — What Can Depend on What

This is the **most important constraint**. Violations are architectural errors.

| Role | Can depend on |
|------|--------------|
| element | element |
| molecule | element, molecule |
| reaction | element, molecule, interface |
| interface | element, molecule |
| adapter | element, molecule, interface, adapter |
| buffer | element, molecule, interface |

**Key implications:**
- Reactions NEVER depend on adapters — they depend on interfaces. Adapters are injected.
- Elements are pure — they depend only on other elements.
- Adapters are the only role that can touch the outside world (DB, HTTP, filesystem).

## Compound Types

| Type | Purpose | Import rules |
|------|---------|-------------|
| **compound** | Standard feature module | Can import other compounds + reagents |
| **reagent** | Shared domain building blocks | Can only import other reagents. Available to all. |
| **solvent** | Cross-cutting infrastructure (logging, config, auth) | Implicitly available everywhere. Can only import reagents. |
| **catalyst** | Composition root. Wires adapters to interfaces. | Singleton. Cannot be imported. |

## Cross-Compound Imports

- **ALWAYS** import through \`public.ts\` — never reach into another compound's internals.
- Each compound's \`public.ts\` is its membrane — only what's listed in \`exports\` is available.
- Solvents are implicit — you don't need to declare them in \`imports\`.

## Workflow — How to Add a Feature

### Adding a new feature compound:
\`\`\`bash
chem add compound <name>                    # creates dir + compound.yaml
chem add unit <name> element SomeId --export
chem add unit <name> molecule SomeEntity --export
chem add unit <name> interface SomeRepo --export
chem add unit <name> adapter PgSomeRepo --implements SomeRepo
chem add unit <name> reaction doSomething --export
\`\`\`

Then implement each stub file. Run validation:
\`\`\`bash
chem check workspace.yaml      # manifest + filesystem checks
chem analyze workspace.yaml    # verify real imports respect bonds
\`\`\`

### Adding a unit to an existing compound:
\`\`\`bash
chem add unit <compound> <role> <Name> --export
# Implement the generated stub
chem check workspace.yaml && chem analyze workspace.yaml
\`\`\`

### Modifying a unit:
1. Read the compound's \`compound.yaml\` to understand the structure
2. Read the unit's source file
3. Make changes respecting bond rules
4. Run \`chem analyze workspace.yaml\` to verify

## Tool Reference

| Command | Purpose |
|---------|---------|
| \`chem check <workspace.yaml>\` | Validate manifests and file structure |
| \`chem scaffold <workspace.yaml>\` | Generate stub files from manifests |
| \`chem analyze <workspace.yaml>\` | Check real TypeScript imports against bonds |
| \`chem graph <workspace.yaml>\` | Output Mermaid dependency diagram |
| \`chem add compound <name>\` | Create a new compound |
| \`chem add unit <compound> <role> <name>\` | Add a unit (flags: \`--export\`, \`--implements <iface>\`) |
| \`chem sync <workspace.yaml>\` | Generate manifests from existing code |

## Rules for AI Assistants

1. **Read before write.** Always read \`workspace.yaml\` and the target \`compound.yaml\` before touching any code.
2. **Use the tool.** Use \`chem add\` to create new compounds and units — don't create files manually.
3. **Respect bonds.** Never import across role boundaries. If the analyzer fails, fix the violation.
4. **Public surface only.** Cross-compound imports go through \`public.ts\`. Never import internal files.
5. **Validate after changes.** Run \`chem check workspace.yaml && chem analyze workspace.yaml\` after every meaningful change.
6. **Adapters are leaf nodes.** They implement interfaces and are only instantiated in the catalyst.
7. **Reactions are the entry points.** They orchestrate the domain logic. External callers invoke reactions, not molecules directly.
8. **When in doubt, read the manifest.** The \`compound.yaml\` is the source of truth for what exists and how it connects.
`;
}
