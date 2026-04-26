// ---------------------------------------------------------------------------
// `formatDiagnostics(diagnostics, format, context)` — single dispatcher used
// by every command (check, analyze, check-edit) to render diagnostics in the
// requested machine-readable or human format.
//
// The canonical four formats:
//   - human:  ANSI-coloured text, the default.
//   - json:   schema-validated envelope (packages/core/schemas/diagnostics.schema.json).
//   - sarif:  SARIF 2.1.0 (packages/core/schemas/sarif-2.1.0.schema.json).
//   - junit:  JUnit XML (one testsuite per workspace, one testcase per
//             compound; structural assertions in tests, no XSD).
//
// All formatters are pure: given (Diagnostic[], FormatContext) they produce
// a string. Callers print to stdout. Newlines are formatter-specific (every
// formatter ends with `\n`).
// ---------------------------------------------------------------------------

import type { Diagnostic } from "@chemag/core/types";
import { formatHuman } from "./human.js";
import { formatJson } from "./json.js";
import { formatSarif } from "./sarif.js";
import { formatJunit } from "./junit.js";

export type FormatName = "human" | "json" | "sarif" | "junit";

/**
 * Context the dispatcher feeds to every formatter. Commands populate the
 * fields they have. JSON/SARIF/JUnit use most of these; the human formatter
 * uses `totals` and `command` to print headers.
 */
export interface FormatContext {
  /** workspace.workspace (the human name from workspace.yaml). Undefined for check-edit when not loaded. */
  workspaceName?: string;
  /** Absolute path to workspace.yaml's directory. Used for SARIF artifact URIs. */
  workspacePath: string;
  /** Which command produced this output. */
  command: "check" | "analyze" | "check-edit";
  /**
   * chemag version. Sourced from packages/cli/src/version.ts (generated at
   * build time from packages/cli/package.json#version — see § "Tool version
   * sourcing" in the wp-005 spec). Used for SARIF tool.driver.version.
   */
  toolVersion: string;
  /**
   * Optional summary fields the human formatter prints in headers.
   * Undefined for analyze (which doesn't aggregate these).
   */
  totals?: {
    compounds?: number;
    units?: number;
    assays?: number;
    passed?: number;
    failed?: number;
  };
  /**
   * For check-edit single-file mode: the file under inspection and its
   * resolved compound + role.
   */
  fileContext?: {
    file: string;
    compound: string | null;
    role: string | null;
  };
  /**
   * Optional grouping for `check`'s human formatter — preserves the per-check
   * pass/fail layout the legacy command produced. Other formats ignore this.
   */
  checks?: { check: string; diagnostics: Diagnostic[] }[];
  /**
   * `check` only — set true to suppress the per-check verbose listing of
   * warnings (pre-wp-005 default).
   */
  verbose?: boolean;
  /** `check` only — flag echoed in the human header. */
  manifestOnly?: boolean;
}

/**
 * Render a diagnostic list in the requested format. Returns a string;
 * the caller is responsible for printing it.
 */
export function formatDiagnostics(
  diagnostics: Diagnostic[],
  format: FormatName,
  context: FormatContext,
): string {
  switch (format) {
    case "human":
      return formatHuman(diagnostics, context);
    case "json":
      return formatJson(diagnostics, context);
    case "sarif":
      return formatSarif(diagnostics, context);
    case "junit":
      return formatJunit(diagnostics, context);
    default: {
      // Exhaustiveness — we accept the cast since `format` may have come
      // from a string CLI argument that we already validated upstream.
      const _exhaustive: never = format;
      throw new Error(`Unknown --format value: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Validate a string as a FormatName. Used by command argument parsers to
 * reject `--format <bogus>` with a clear error before dispatch.
 */
export function isFormatName(s: string): s is FormatName {
  return s === "human" || s === "json" || s === "sarif" || s === "junit";
}

export { formatHuman } from "./human.js";
export { formatJson } from "./json.js";
export { formatSarif } from "./sarif.js";
export { formatJunit } from "./junit.js";
