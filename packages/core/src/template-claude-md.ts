import type { LanguagePlugin } from "./plugin-interface.js";

// ---------------------------------------------------------------------------
// Core sections (language-agnostic)
// ---------------------------------------------------------------------------

function coreIntro(name: string): string {
  return `# ${name} — Chem Architecture

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
`;
}

function coreWorkflow(): string {
  return `## Workflow — How to Add a Feature

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
| \`chem analyze <workspace.yaml>\` | Check real imports against bonds |
| \`chem graph <workspace.yaml>\` | Output Mermaid dependency diagram |
| \`chem add compound <name>\` | Create a new compound |
| \`chem add unit <compound> <role> <name>\` | Add a unit (flags: \`--export\`, \`--implements <iface>\`) |
| \`chem sync <workspace.yaml>\` | Generate manifests from existing code |

## Rules for AI Assistants

1. **Read before write.** Always read \`workspace.yaml\` and the target \`compound.yaml\` before touching any code.
2. **Use the tool.** Use \`chem add\` to create new compounds and units — don't create files manually.
3. **Respect bonds.** Never import across role boundaries. If the analyzer fails, fix the violation.
4. **Public surface only.** Cross-compound imports go through the public surface. Never import internal files.
5. **Validate after changes.** Run \`chem check workspace.yaml && chem analyze workspace.yaml\` after every meaningful change.
6. **Adapters are leaf nodes.** They implement interfaces and are only instantiated in the catalyst.
7. **Reactions are the entry points.** They orchestrate the domain logic. External callers invoke reactions, not molecules directly.
8. **When in doubt, read the manifest.** The \`compound.yaml\` is the source of truth for what exists and how it connects.
`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Headings that belong to the core template. Any section in the plugin
 * output with a heading NOT in this set is considered language-specific.
 */
const CORE_HEADINGS = new Set([
  "Core Concept",
  "Roles — What Each Unit Type Means",
  "Decision Flowchart — Where Does New Code Go?",
  "Bond Rules — What Can Depend on What",
  "Compound Types",
  "Workflow — How to Add a Feature",
  "Workflow",
  "Tool Reference",
  "Rules for AI Assistants",
]);

/**
 * Generate the full CLAUDE.md content for a workspace.
 * Combines language-agnostic core sections with language-specific
 * content from the plugin.
 */
export function generateClaudeMd(
  name: string,
  plugin: LanguagePlugin,
): string {
  const pluginContent = plugin.generateClaudeMd(name);
  const languageSection = extractLanguageSection(pluginContent);

  return coreIntro(name) + languageSection + coreWorkflow();
}

/**
 * Extract language-specific sections from a plugin's generateClaudeMd output.
 *
 * Splits the plugin output into sections by `## ` headings. Any section
 * whose heading is NOT in CORE_HEADINGS is considered language-specific
 * and gets included in the output.
 */
function extractLanguageSection(pluginMd: string): string {
  // Split into sections by ## headings
  const sections: { heading: string; content: string }[] = [];
  const lines = pluginMd.split("\n");
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      if (currentHeading || currentLines.length > 0) {
        sections.push({ heading: currentHeading, content: currentLines.join("\n") });
      }
      currentHeading = match[1];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  // Push the last section
  if (currentHeading || currentLines.length > 0) {
    sections.push({ heading: currentHeading, content: currentLines.join("\n") });
  }

  // Collect sections with non-core headings
  const languageSections: string[] = [];
  for (const section of sections) {
    if (section.heading && !CORE_HEADINGS.has(section.heading)) {
      languageSections.push(`## ${section.heading}\n${section.content}`);
    }
  }

  if (languageSections.length === 0) return "\n";

  const result = languageSections.join("\n").trim();
  return result + "\n\n";
}
