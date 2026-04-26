// ---------------------------------------------------------------------------
// JSON formatter — emits the canonical schema-validated envelope defined in
// packages/core/schemas/diagnostics.schema.json. This is the shape used by
// `chemag <command> --format json`. The deprecated `--json` flag on check /
// analyze keeps the legacy ad-hoc shape for backward compatibility and is
// emitted directly from those commands; this module is not involved.
// ---------------------------------------------------------------------------

import type { Diagnostic } from "@chemag/core/types";
import type { FormatContext } from "./index.js";

export interface DiagnosticsReport {
  schemaVersion: "1.0.0";
  tool: { name: "chemag"; version: string };
  command: "check" | "analyze" | "check-edit";
  workspace?: { name?: string; path: string };
  summary: {
    errors: number;
    warnings: number;
    compounds?: number;
    units?: number;
    assays?: number;
  };
  diagnostics: Diagnostic[];
}

/** Build the structured report (without serialising). Useful for tests. */
export function buildJsonReport(
  diagnostics: Diagnostic[],
  context: FormatContext,
): DiagnosticsReport {
  const errors = diagnostics.filter((d) => d.level === "error").length;
  const warnings = diagnostics.filter((d) => d.level === "warning").length;

  const summary: DiagnosticsReport["summary"] = { errors, warnings };
  if (context.totals) {
    if (typeof context.totals.compounds === "number") summary.compounds = context.totals.compounds;
    if (typeof context.totals.units === "number") summary.units = context.totals.units;
    if (typeof context.totals.assays === "number") summary.assays = context.totals.assays;
  }

  const workspace: DiagnosticsReport["workspace"] = { path: context.workspacePath };
  if (context.workspaceName !== undefined) workspace.name = context.workspaceName;

  return {
    schemaVersion: "1.0.0",
    tool: { name: "chemag", version: context.toolVersion },
    command: context.command,
    workspace,
    summary,
    diagnostics,
  };
}

/** Render the JSON envelope as a (pretty-printed) string ending in `\n`. */
export function formatJson(diagnostics: Diagnostic[], context: FormatContext): string {
  const report = buildJsonReport(diagnostics, context);
  return `${JSON.stringify(report, null, 2)}\n`;
}
