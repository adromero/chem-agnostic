// ---------------------------------------------------------------------------
// Shared body renderer. Every emitter that ships an `## Architecture rules`
// block (AGENTS.md, CLAUDE.md, .aider/CONVENTIONS.md, .clinerules) renders
// its core content from `renderSharedBody` so the snapshot tests can assert
// no drift between the formats.
//
// Cursor MDC and Copilot Instructions render condensed variants in their
// own modules — they cannot share this builder verbatim because their line
// budgets are tighter.
// ---------------------------------------------------------------------------

import type { Diagnostic } from "../types.js";
import type { RulesContent } from "./types.js";

/**
 * Render the chemag-managed body (without the start/end markers). Caller
 * wraps the returned string with `wrapWithMarkers`.
 *
 * Total line count target: ≤80 (validated by callers).
 */
export function renderSharedBody(content: RulesContent): string {
  const lines: string[] = [];

  lines.push(`# ${content.workspaceName} — Architecture rules`);
  lines.push("");
  lines.push(content.intro);
  lines.push("");

  lines.push("## Architecture summary");
  lines.push(content.architectureSummary);
  lines.push("");

  lines.push("## Dependency rules");
  lines.push(content.dependencyRulesTable);
  lines.push("");

  lines.push("## Cross-module imports");
  lines.push(content.crossModuleRule);
  lines.push("");

  lines.push("## Validation");
  lines.push(content.toolingPointer);
  lines.push("");

  lines.push("## Where to look");
  for (const item of content.whereToLook) {
    lines.push(`- ${item}`);
  }

  // Trim accidental trailing blank lines so the output is deterministic.
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}

/**
 * Render the optional violations block. Returns `""` when there are no
 * violations (or `--include-violations` was not passed). The block lives
 * OUTSIDE the chemag markers so it does not count against the budget.
 */
export function renderViolations(content: RulesContent): string {
  const v = content.violations;
  if (v === undefined || v.length === 0) return "";

  const lines: string[] = [];
  lines.push("## Current violations (auto-collected)");
  lines.push("");
  lines.push(`<!-- chemag detected ${v.length} diagnostic(s) at emit time -->`);
  for (const diag of v) {
    lines.push(formatDiagnosticAsHint(diag));
  }
  return lines.join("\n");
}

function formatDiagnosticAsHint(diag: Diagnostic): string {
  const where = diag.file ? ` in ${diag.file}` : "";
  return `<!-- fix me: ${diag.code}${where} — ${diag.message} -->`;
}
