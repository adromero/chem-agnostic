// ---------------------------------------------------------------------------
// .aider/CONVENTIONS.md emitter.
//
// Aider prepends conventions to every prompt. We share the standard body
// with AGENTS/CLAUDE and then add an `## Aider behavior` tail at the end
// inside the chemag block — the spec requires the file to terminate with
// that section.
// ---------------------------------------------------------------------------

import { wrapWithMarkers } from "./markers.js";
import { DEFAULT_PATHS } from "./paths.js";
import { renderSharedBody, renderViolations } from "./shared-body.js";
import type { EmittedFile, EmitOptions, RulesContent } from "./types.js";

export function emitAiderConventions(
  content: RulesContent,
  options: EmitOptions = {},
): EmittedFile {
  const budget = options.maxLines ?? 80;
  const sharedBody = renderSharedBody(content);
  const tail = renderAiderTail();
  const fullBody = `${sharedBody}\n\n${tail}`;
  const block = wrapWithMarkers(fullBody);
  const trailing = renderViolations(content);
  const final = composeFirstWrite(block, "", trailing);
  const warnings = checkBudget(block, budget);

  return {
    path: DEFAULT_PATHS.aider,
    block,
    leading: "",
    trailing,
    body: final,
    warnings,
  };
}

function renderAiderTail(): string {
  return [
    "## Aider behavior",
    "- Do not edit files outside `src/`.",
    "- Run `chemag check-edit <file>` after each /add or /edit.",
    "- Treat dependency-rule violations as compile errors.",
  ].join("\n");
}

function composeFirstWrite(block: string, leading: string, trailing: string): string {
  const parts: string[] = [];
  if (leading !== "") parts.push(leading);
  parts.push(block);
  if (trailing !== "") parts.push(trailing);
  return `${parts.join("\n\n")}\n`;
}

function checkBudget(block: string, budget: number): string[] {
  const lines = block.split("\n").length;
  if (lines > budget) {
    return [`aider: emitted ${lines} lines (budget ${budget})`];
  }
  return [];
}
