// ---------------------------------------------------------------------------
// CLAUDE.md emitter.
//
// Produces a compact rule file consumed by Claude Code. The body is the same
// `RulesContent` rendered by `renderSharedBody` (shared with AGENTS.md so
// the two files cannot drift); two extras layer on top:
//
//   1. Optional `pluginContent`: the raw output of the active language
//      plugin's `LanguagePlugin.generateClaudeMd(workspaceName)`. We filter
//      it through `extractLanguageSection` to keep only the language-
//      specific subsections (any heading not in `CORE_HEADINGS`) so it
//      doesn't duplicate what the shared body already covered.
//
//   2. A Claude-specific tail: the hook expectations + MCP tool names that
//      Claude Code uses to drive `chemag check-edit` automatically. The
//      tail lives INSIDE the chemag block (counts toward the budget).
//
// `extractLanguageSection` and `CORE_HEADINGS` live here (relocated from
// `template-claude-md.ts`); they are exported so the legacy
// `generateClaudeMd(name, plugin)` shim can keep working unchanged.
// ---------------------------------------------------------------------------

import { wrapWithMarkers } from "./markers.js";
import { DEFAULT_PATHS } from "./paths.js";
import { renderSharedBody, renderViolations } from "./shared-body.js";
import type { EmittedFile, EmitOptions, RulesContent } from "./types.js";

export interface ClaudeEmitOptions extends EmitOptions {
  /**
   * Raw output of `LanguagePlugin.generateClaudeMd(workspaceName)`. The
   * Claude emitter splits this on `## ` headings and keeps only the
   * non-core sections (those whose heading is NOT in `CORE_HEADINGS`).
   * When omitted, the language section is empty.
   */
  pluginContent?: string;
}

export function emitClaudeMd(content: RulesContent, options: ClaudeEmitOptions = {}): EmittedFile {
  const budget = options.maxLines ?? 80;
  const sharedBody = renderSharedBody(content);
  const claudeTail = renderClaudeTail();
  const chemagBody = `${sharedBody}\n\n${claudeTail}`;
  const block = wrapWithMarkers(chemagBody);

  // Plugin-contributed language section sits OUTSIDE the markers (so it
  // doesn't get clobbered on re-emit and doesn't count against the budget).
  const languageSection = extractLanguageSection(options.pluginContent ?? "");
  const violations = renderViolations(content);
  const trailingParts: string[] = [];
  if (languageSection.trim().length > 0) trailingParts.push(languageSection.trim());
  if (violations !== "") trailingParts.push(violations);
  const trailing = trailingParts.join("\n\n");

  const final = composeFirstWrite(block, "", trailing);
  const warnings = checkBudget(block, budget);

  return {
    path: DEFAULT_PATHS.claude,
    block,
    leading: "",
    trailing,
    body: final,
    warnings,
  };
}

function composeFirstWrite(block: string, leading: string, trailing: string): string {
  const parts: string[] = [];
  if (leading !== "") parts.push(leading);
  parts.push(block);
  if (trailing !== "") parts.push(trailing);
  return `${parts.join("\n\n")}\n`;
}

/**
 * Claude-specific tail. Sits inside the chemag markers (so it counts toward
 * the budget) and tells the agent how to use the MCP tools / hooks that
 * Claude Code wires up automatically.
 */
function renderClaudeTail(): string {
  return [
    "## Claude Code hooks",
    "Run `chemag check-edit <file>` after every edit. The MCP server (when",
    "available) exposes this as `chemag/check-edit` so PreEdit hooks can",
    "block bond-violating writes before the file ever lands on disk.",
  ].join("\n");
}

function checkBudget(block: string, budget: number): string[] {
  const lines = block.split("\n").length;
  if (lines > budget) {
    return [`claude: emitted ${lines} lines (budget ${budget})`];
  }
  return [];
}

// ---------------------------------------------------------------------------
// CORE_HEADINGS + extractLanguageSection — RELOCATED from template-claude-md.ts.
//
// Plugin output sections whose heading is NOT in `CORE_HEADINGS` are treated
// as language-specific and merged into the final CLAUDE.md.
// ---------------------------------------------------------------------------

function buildCoreHeadingSet(): Set<string> {
  return new Set<string>([
    // Core sections (shared body) — both vocabularies
    "Architecture summary",
    "Dependency rules",
    "Cross-module imports",
    "Validation",
    "Where to look",
    "Claude Code hooks",
    // Heading variants the legacy template emitted (kept for parity with the
    // pre-WP-009 generator so existing plugin output continues to be filtered
    // correctly).
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
}

export const CORE_HEADINGS = buildCoreHeadingSet();

/**
 * Extract language-specific sections from a plugin's `generateClaudeMd`
 * output. Splits the input into sections by `## ` headings and returns the
 * concatenation of every section whose heading is NOT in `CORE_HEADINGS`.
 *
 * Returns `""` when no language-specific sections are found.
 */
export function extractLanguageSection(pluginMd: string): string {
  if (pluginMd.length === 0) return "";

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
  if (currentHeading || currentLines.length > 0) {
    sections.push({ heading: currentHeading, content: currentLines.join("\n") });
  }

  const languageSections: string[] = [];
  for (const section of sections) {
    if (section.heading && !CORE_HEADINGS.has(section.heading)) {
      languageSections.push(`## ${section.heading}\n${section.content}`);
    }
  }

  if (languageSections.length === 0) return "";
  return languageSections.join("\n").trim();
}
