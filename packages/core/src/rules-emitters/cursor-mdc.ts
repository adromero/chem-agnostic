// ---------------------------------------------------------------------------
// .cursor/rules/architecture.mdc emitter.
//
// MDC files have YAML frontmatter (description / globs / alwaysApply). The
// chemag markers wrap the body section after the frontmatter, never the
// frontmatter itself — `mergeBetweenMarkers({ isMdc: true })` knows to
// regenerate the frontmatter on every run while preserving body content.
//
// Body budget: ≤60 lines. Tighter than AGENTS/CLAUDE because Cursor
// includes the rule text on every prompt and the prompt budget is
// expensive.
// ---------------------------------------------------------------------------

import { wrapWithMarkers } from "./markers.js";
import { DEFAULT_PATHS } from "./paths.js";
import { renderViolations } from "./shared-body.js";
import type { EmittedFile, EmitOptions, RulesContent } from "./types.js";

export function emitCursorMdc(content: RulesContent, options: EmitOptions = {}): EmittedFile {
  const budget = options.maxLines ?? 60;
  const frontmatter = renderFrontmatter(content);
  const body = renderCondensedBody(content);
  const block = wrapWithMarkers(body);
  const trailing = renderViolations(content);
  const final = composeFirstWrite(block, frontmatter, trailing);
  const warnings = checkBudget(block, budget);

  return {
    path: DEFAULT_PATHS.cursor,
    block,
    leading: frontmatter,
    trailing,
    body: final,
    warnings,
  };
}

function renderFrontmatter(content: RulesContent): string {
  return [
    "---",
    `description: Architecture rules for ${content.workspaceName} (chemag)`,
    "globs:",
    '  - "src/**/*"',
    "alwaysApply: true",
    "---",
  ].join("\n");
}

/**
 * Cursor body: extremely condensed. The dependency-rules table goes in
 * verbatim (it's the load-bearing rule); everything else collapses to
 * one-liners.
 */
function renderCondensedBody(content: RulesContent): string {
  const lines: string[] = [];
  lines.push(`# ${content.workspaceName} architecture`);
  lines.push("");
  lines.push(content.crossModuleRule);
  lines.push("");
  lines.push("## Dependency rules");
  lines.push(content.dependencyRulesTable);
  lines.push("");
  lines.push("## Validation");
  lines.push("Run `chemag check-edit <file>` after every edit.");
  return lines.join("\n");
}

function composeFirstWrite(block: string, leading: string, trailing: string): string {
  const parts: string[] = [];
  if (leading !== "") parts.push(leading);
  parts.push(block);
  if (trailing !== "") parts.push(trailing);
  return `${parts.join("\n")}\n`;
}

function checkBudget(block: string, budget: number): string[] {
  const lines = block.split("\n").length;
  if (lines > budget) {
    return [`cursor: emitted ${lines} lines (budget ${budget})`];
  }
  return [];
}
