// ---------------------------------------------------------------------------
// SARIF 2.1.0 formatter — hand-rolled (no runtime deps). Produces a single
// Run with rules derived from @chemag/core's DIAGNOSTIC_CODES registry and
// results derived from the diagnostic list.
//
// The vendored schema at packages/core/schemas/sarif-2.1.0.schema.json is
// the validator-of-record (tests use ajv). If you change the shape here,
// run the SARIF tests — never edit the vendored schema.
//
// Notes / decisions:
//   - tool.driver.informationUri is set to the canonical chemag-org GitHub
//     repo URL. Once wp-052 (marketing site) ships and chemag.dev resolves,
//     swap it for "https://chemag.dev". Do NOT use "TBD" — strict ajv
//     validation against the SARIF schema rejects anything that isn't a
//     URI.
//   - When a diagnostic has no `file`, the result is emitted with
//     `locations: []`. The SARIF 2.1.0 spec permits results without
//     physical locations — these are workspace-level findings.
//   - We populate result.message.text from Diagnostic.message; consumers
//     that want the original parameterised string should consult the
//     trKey via the registry (we attach `properties.code` for that).
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DIAGNOSTIC_CODES,
  type DiagnosticCode,
  type DiagnosticCodeMeta,
  docLinkFor,
} from "@chemag/core/diagnostics";
import type { Diagnostic } from "@chemag/core/types";
import type { FormatContext } from "./index.js";

/** SARIF 2.1.0 schema URL — matches the vendored schema's `$id`. */
export const SARIF_SCHEMA_URL =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";

/** SARIF version literal. */
export const SARIF_VERSION = "2.1.0";

/**
 * Placeholder until wp-052 ships chemag.dev. Both values pass strict ajv
 * URI validation; we prefer the GitHub repo URL because it actually
 * resolves today.
 */
export const TOOL_INFORMATION_URI = "https://github.com/chemag-org/chemag";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Build the SARIF log object. Useful for tests; the formatter wraps it. */
export function buildSarifLog(diagnostics: Diagnostic[], context: FormatContext): SarifLog {
  return {
    $schema: SARIF_SCHEMA_URL,
    version: SARIF_VERSION,
    runs: [buildRun(diagnostics, context)],
  };
}

/** Render the SARIF log as a JSON string ending in `\n`. */
export function formatSarif(diagnostics: Diagnostic[], context: FormatContext): string {
  return `${JSON.stringify(buildSarifLog(diagnostics, context), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildRun(diagnostics: Diagnostic[], context: FormatContext): SarifRun {
  return {
    tool: {
      driver: {
        name: "chemag",
        version: context.toolVersion,
        informationUri: TOOL_INFORMATION_URI,
        rules: buildRules(),
      },
    },
    results: diagnostics.map((d) => buildResult(d, context)),
  };
}

function buildRules(): SarifRule[] {
  return Object.values(DIAGNOSTIC_CODES).map((meta) => buildRule(meta));
}

function buildRule(meta: DiagnosticCodeMeta): SarifRule {
  return {
    id: meta.code,
    name: pascalCaseCode(meta.code),
    shortDescription: { text: meta.trKey },
    helpUri: docLinkFor(meta),
    defaultConfiguration: { level: toSarifLevel(meta.level) },
  };
}

function buildResult(d: Diagnostic, context: FormatContext): SarifResult {
  const result: SarifResult = {
    ruleId: d.code,
    level: toSarifLevel(d.level),
    message: { text: d.message },
    locations: buildLocations(d, context),
    properties: {
      check: d.check,
      ...(d.compound !== undefined ? { compound: d.compound } : {}),
    },
  };
  return result;
}

function buildLocations(d: Diagnostic, context: FormatContext): SarifLocation[] {
  if (!d.file) return [];

  const uri = artifactUri(d.file, context.workspacePath);
  const region: SarifRegion = {};
  if (typeof d.line === "number") region.startLine = d.line;
  if (typeof d.column === "number") region.startColumn = d.column;

  const physicalLocation: SarifPhysicalLocation = {
    artifactLocation: { uri },
  };
  if (region.startLine !== undefined) physicalLocation.region = region;

  return [{ physicalLocation }];
}

/**
 * Resolve a diagnostic file path to a SARIF artifact URI. Returns a relative
 * URI (POSIX separators) when the file lives under the workspace root, or a
 * `file://` URI otherwise. SARIF requires URI strings, not bare paths.
 */
function artifactUri(file: string, workspacePath: string): string {
  if (path.isAbsolute(file)) {
    const rel = path.relative(workspacePath, file);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      // Inside the workspace — emit a workspace-relative URI with POSIX seps.
      return rel.split(path.sep).join("/");
    }
    return pathToFileURL(file).href;
  }
  // Already relative — normalise separators.
  return file.split(path.sep).join("/");
}

/**
 * Map a chemag diagnostic level to a SARIF 2.1.0 level. Per the SARIF spec,
 * `"note"` denotes informational findings that do not affect run pass/fail —
 * the correct codomain for `"suggestion"`. Note that the previous binary
 * mapping (`level === "warning" ? "warning" : "error"`) would have silently
 * elevated `"suggestion"` to SARIF `"error"` — replaced.
 */
function toSarifLevel(level: "error" | "warning" | "suggestion"): "error" | "warning" | "note" {
  if (level === "error") return "error";
  if (level === "warning") return "warning";
  return "note";
}

/** "CHEM-BOND-001" -> "ChemBond001". */
function pascalCaseCode(code: DiagnosticCode): string {
  return code
    .split("-")
    .map((p) => p[0] + p.slice(1).toLowerCase())
    .join("");
}

// ---------------------------------------------------------------------------
// Local SARIF subset types — kept narrow to the fields we actually emit.
// We deliberately avoid pulling in a third-party SARIF type definition;
// the vendored JSON Schema is the contract of record.
// ---------------------------------------------------------------------------

export interface SarifLog {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

export interface SarifRun {
  tool: { driver: SarifToolDriver };
  results: SarifResult[];
}

export interface SarifToolDriver {
  name: "chemag";
  version: string;
  informationUri: string;
  rules: SarifRule[];
}

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  helpUri: string;
  defaultConfiguration: { level: "error" | "warning" | "note" };
}

export interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: SarifLocation[];
  properties: Record<string, unknown>;
}

export interface SarifLocation {
  physicalLocation: SarifPhysicalLocation;
}

export interface SarifPhysicalLocation {
  artifactLocation: { uri: string };
  region?: SarifRegion;
}

export interface SarifRegion {
  startLine?: number;
  startColumn?: number;
}
