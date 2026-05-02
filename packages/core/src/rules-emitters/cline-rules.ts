// ---------------------------------------------------------------------------
// .clinerules emitter.
// ---------------------------------------------------------------------------

import { wrapWithMarkers } from "./markers.js";
import { DEFAULT_PATHS } from "./paths.js";
import { renderSharedBody, renderViolations } from "./shared-body.js";
import type { EmittedFile, EmitOptions, RulesContent } from "./types.js";

export function emitClineRules(content: RulesContent, options: EmitOptions = {}): EmittedFile {
  const budget = options.maxLines ?? 80;
  const body = renderSharedBody(content);
  const block = wrapWithMarkers(body);
  const trailing = renderViolations(content);
  const final = composeFirstWrite(block, "", trailing);
  const warnings = checkBudget(block, budget);

  return {
    path: DEFAULT_PATHS.cline,
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

function checkBudget(block: string, budget: number): string[] {
  const lines = block.split("\n").length;
  if (lines > budget) {
    return [`cline: emitted ${lines} lines (budget ${budget})`];
  }
  return [];
}
