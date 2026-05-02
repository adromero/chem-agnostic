// ---------------------------------------------------------------------------
// AGENTS.md emitter. Compact, human-readable rule file consumed by Codex
// (alias `--tool codex`) and any agent that reads AGENTS.md by convention.
//
// The emitter shares its body shape with claude-md.ts: the architecture
// summary, dependency-rules table, and cross-module rule come from the same
// `RulesContent` object so the two never drift.
// ---------------------------------------------------------------------------

import { wrapWithMarkers } from "./markers.js";
import { DEFAULT_PATHS } from "./paths.js";
import { renderSharedBody, renderViolations } from "./shared-body.js";
import type { EmittedFile, EmitOptions, RulesContent } from "./types.js";

export function emitAgentsMd(content: RulesContent, options: EmitOptions = {}): EmittedFile {
  const budget = options.maxLines ?? 80;
  const body = renderSharedBody(content);
  const block = wrapWithMarkers(body);
  const trailing = renderViolations(content);
  const final = composeFirstWrite(block, "", trailing);
  const warnings = checkBudget(block, budget, "agents");

  return {
    path: DEFAULT_PATHS.agents,
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

function checkBudget(block: string, budget: number, tool: string): string[] {
  const lines = block.split("\n").length;
  if (lines > budget) {
    return [`${tool}: emitted ${lines} lines (budget ${budget})`];
  }
  return [];
}
