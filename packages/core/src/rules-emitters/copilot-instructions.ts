// ---------------------------------------------------------------------------
// .github/copilot-instructions.md emitter.
// ---------------------------------------------------------------------------

import { wrapWithMarkers } from "./markers.js";
import { DEFAULT_PATHS } from "./paths.js";
import { renderViolations } from "./shared-body.js";
import type { EmittedFile, EmitOptions, RulesContent } from "./types.js";

export function emitCopilotInstructions(
  content: RulesContent,
  options: EmitOptions = {},
): EmittedFile {
  const budget = options.maxLines ?? 40;
  const body = renderCopilotBody(content);
  const block = wrapWithMarkers(body);
  const trailing = renderViolations(content);
  const final = composeFirstWrite(block, "", trailing);
  const warnings = checkBudget(block, budget);

  return {
    path: DEFAULT_PATHS.copilot,
    block,
    leading: "",
    trailing,
    body: final,
    warnings,
  };
}

function renderCopilotBody(content: RulesContent): string {
  const lines: string[] = [];
  lines.push(`# ${content.workspaceName} — Copilot instructions`);
  lines.push("");
  lines.push(content.crossModuleRule);
  lines.push("");
  lines.push(content.dependencyRulesTable);
  lines.push("");
  lines.push("Run `chemag check-edit <file>` after every edit.");
  return lines.join("\n");
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
    return [`copilot: emitted ${lines} lines (budget ${budget})`];
  }
  return [];
}
