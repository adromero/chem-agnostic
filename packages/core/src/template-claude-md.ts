import type { LanguagePlugin } from "./plugin-interface.js";
import { tr } from "./vocabulary/index.js";

// ---------------------------------------------------------------------------
// Core sections (language-agnostic, vocabulary-aware)
// ---------------------------------------------------------------------------

function coreIntro(name: string): string {
  // intro key includes the leading H1; subsequent tables are H2 sections.
  const decisionFlowchart = [
    "## Decision Flowchart — Where Does New Code Go?",
    "",
    "When adding functionality, follow this decision tree:",
    "",
    `1. **Is it a primitive value with no dependencies?** → ${tr("role.element")}`,
    `2. **Is it domain state composed of other values?** → ${tr("role.molecule")}`,
    `3. **Is it a workflow that coordinates state changes?** → ${tr("role.reaction")}`,
    `4. **Does it define a capability boundary (IO, external service)?** → ${tr("role.interface")}`,
    `5. **Does it implement a port with real IO?** → ${tr("role.adapter")}`,
    `6. **Does it wrap a use-case (auth, logging, validation)?** → ${tr("role.buffer")}`,
    "",
    "If you're unsure, start with the simplest role. You can promote later as complexity grows.",
  ].join("\n");

  return [
    tr("claude_md.intro", { name }),
    "",
    tr("claude_md.roles_table"),
    "",
    decisionFlowchart,
    "",
    tr("claude_md.bonds_table"),
    "",
    tr("claude_md.compound_types"),
    "",
  ].join("\n");
}

function coreWorkflow(): string {
  return [
    tr("claude_md.workflow"),
    "",
    tr("claude_md.tool_reference"),
    "",
    tr("claude_md.ai_rules"),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Static set of heading texts that the core template emits across both
 * locales. Computed once at module load.
 *
 * Plugin output sections whose heading is NOT in this set are treated as
 * language-specific and merged into the final CLAUDE.md.
 */
function buildCoreHeadingSet(): Set<string> {
  const headings = new Set<string>([
    // Across both locales the names overlap; we list every variant we ship.
    // Standard
    "Core Concept",
    "Roles — What Each Unit Type Means",
    "Decision Flowchart — Where Does New Code Go?",
    "Dependency Rules — What Can Depend on What",
    "Bond Rules — What Can Depend on What",
    "Module Types",
    "Compound Types",
    "Workflow — How to Add a Feature",
    "Workflow",
    "Tool Reference",
    "Rules for AI Assistants",
  ]);
  return headings;
}

const CORE_HEADINGS = buildCoreHeadingSet();

/**
 * Generate the full CLAUDE.md content for a workspace.
 * Combines language-agnostic core sections (emitted via tr()) with
 * language-specific content from the plugin. The active vocabulary is read
 * from module-global vocabulary state — callers control the locale via
 * setVocabulary or applyWorkspaceVocabulary before invoking this function.
 */
export function generateClaudeMd(name: string, plugin: LanguagePlugin): string {
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
  return `${result}\n\n`;
}
