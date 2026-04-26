// ---------------------------------------------------------------------------
// Human (ANSI) formatter — extracted from the legacy cmd-check / cmd-analyze /
// cmd-check-edit emitters so all three commands share one implementation. The
// output is byte-for-byte identical to the pre-wp-005 layout for the cases
// they each produced; that's what the snapshot tests pin.
// ---------------------------------------------------------------------------

import type { Diagnostic } from "@chemag/core/types";
import type { FormatContext } from "./index.js";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const YEL = "\x1b[33m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

/** Render diagnostics in the legacy ANSI-coloured layout. */
export function formatHuman(diagnostics: Diagnostic[], context: FormatContext): string {
  switch (context.command) {
    case "check":
      return renderCheck(diagnostics, context);
    case "analyze":
      return renderAnalyze(diagnostics, context);
    case "check-edit":
      return renderCheckEdit(diagnostics, context);
  }
}

// ---------------------------------------------------------------------------
// `chemag check` — preserved per-check grouping from the legacy emitter.
// The dispatcher passes `context.checks` (one entry per check function the
// command ran) so we can show pass/fail per check in the same order.
// ---------------------------------------------------------------------------

function renderCheck(_diagnostics: Diagnostic[], context: FormatContext): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`${BLD}chemtest check${R}`);
  lines.push("");

  if (context.workspaceName !== undefined) {
    lines.push(`${BLD}Workspace:${R} ${context.workspaceName}`);
  }

  const t = context.totals ?? {};
  if (typeof t.compounds === "number") {
    // Mirror the legacy "compound: N | reagent: N" line — the command
    // already aggregated this into `totals` before calling us.
    lines.push(`${DIM}  compound: ${t.compounds}${R}`);
  }
  if (typeof t.units === "number" || typeof t.assays === "number") {
    const u = t.units ?? 0;
    const a = t.assays ?? 0;
    lines.push(`${DIM}  Units: ${u} | Assays: ${a}${R}`);
  }
  if (context.manifestOnly) {
    lines.push(`${DIM}  Mode: manifest-only${R}`);
  }
  lines.push("");

  const groups = context.checks ?? [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let passed = 0;
  let failed = 0;

  for (const { check: name, diagnostics: diags } of groups) {
    const errors = diags.filter((d) => d.level === "error");
    const warnings = diags.filter((d) => d.level === "warning");
    totalErrors += errors.length;
    totalWarnings += warnings.length;
    if (errors.length > 0) failed++;
    else passed++;

    if (errors.length > 0) {
      const wsfx = warnings.length ? `, ${warnings.length} warning(s)` : "";
      lines.push(`  ${RED}✗${R}  ${name} ${DIM}— ${errors.length} error(s)${wsfx}${R}`);
      for (const d of diags) {
        const color = d.level === "error" ? RED : YEL;
        const pfx = d.compound ? `${DIM}${d.compound}${R} > ` : "";
        lines.push(`     ${color}${d.level}${R}: ${pfx}${d.message}`);
        if (d.hint) lines.push(`     ${DIM}${d.hint}${R}`);
      }
      lines.push("");
    } else if (warnings.length > 0) {
      lines.push(`  ${YEL}~${R}  ${name} ${DIM}— ${warnings.length} warning(s)${R}`);
      if (context.verbose) {
        for (const d of warnings) {
          const pfx = d.compound ? `${DIM}${d.compound}${R} > ` : "";
          lines.push(`     ${YEL}warn${R}: ${pfx}${d.message}`);
          if (d.hint) lines.push(`     ${DIM}${d.hint}${R}`);
        }
        lines.push("");
      }
    } else {
      lines.push(`  ${GRN}✓${R}  ${name}`);
    }
  }

  lines.push("");
  if (totalErrors === 0) {
    const w = totalWarnings
      ? ` ${YEL}(${totalWarnings} warning${totalWarnings !== 1 ? "s" : ""})${R}`
      : "";
    lines.push(`${GRN}${BLD}All ${passed} checks passed${R}${w}`);
  } else {
    const w = totalWarnings ? `, ${totalWarnings} warning${totalWarnings !== 1 ? "s" : ""}` : "";
    lines.push(
      `${RED}${BLD}${failed} check${failed !== 1 ? "s" : ""} failed${R} — ${totalErrors} error${totalErrors !== 1 ? "s" : ""}${w} | ${GRN}${passed} passed${R}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// `chemag analyze` — preserved layout from the legacy emitter.
// Always groups by check name in the wp-004 order:
//   import-bonds, import-bypass, import-undeclared.
// ---------------------------------------------------------------------------

function renderAnalyze(diagnostics: Diagnostic[], context: FormatContext): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`${BLD}chemtest analyze${R}`);
  lines.push("");
  if (context.workspaceName !== undefined) {
    lines.push(`${BLD}Workspace:${R} ${context.workspaceName}`);
  }
  const u = context.totals?.units;
  if (typeof u === "number") {
    lines.push(`${DIM}  Scanning ${u} source files${R}`);
  }
  lines.push("");

  const errors = diagnostics.filter((d) => d.level === "error");
  const warnings = diagnostics.filter((d) => d.level === "warning");

  const byCheck = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    let bucket = byCheck.get(d.check);
    if (!bucket) {
      bucket = [];
      byCheck.set(d.check, bucket);
    }
    bucket.push(d);
  }

  const checkNames = ["import-bonds", "import-bypass", "import-undeclared"];
  for (const name of checkNames) {
    const group = byCheck.get(name) ?? [];
    const errs = group.filter((d) => d.level === "error");
    if (errs.length > 0) {
      lines.push(`  ${RED}✗${R}  ${name} ${DIM}— ${errs.length} violation(s)${R}`);
      for (const d of errs) {
        const pfx = d.compound ? `${DIM}${d.compound}${R} > ` : "";
        lines.push(`     ${RED}error${R}: ${pfx}${d.message}`);
        if (d.hint) lines.push(`     ${DIM}${d.hint}${R}`);
      }
      lines.push("");
    } else {
      lines.push(`  ${GRN}✓${R}  ${name}`);
    }
  }

  lines.push("");
  if (errors.length === 0) {
    const w = warnings.length
      ? ` ${YEL}(${warnings.length} warning${warnings.length !== 1 ? "s" : ""})${R}`
      : "";
    lines.push(`${GRN}${BLD}All imports valid${R}${w}`);
  } else {
    lines.push(
      `${RED}${BLD}${errors.length} import violation${errors.length !== 1 ? "s" : ""} found${R}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// `chemag check-edit` — preserves the wp-004 layout. Single file under test;
// no per-check grouping; warnings render as `warn` lines.
// ---------------------------------------------------------------------------

function renderCheckEdit(diagnostics: Diagnostic[], context: FormatContext): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`${BLD}chemag check-edit${R}`);
  lines.push("");
  if (context.fileContext) {
    lines.push(`${BLD}File:${R} ${context.fileContext.file}`);
    if (context.fileContext.compound) {
      lines.push(`${BLD}Compound:${R} ${context.fileContext.compound}`);
    }
    if (context.fileContext.role) {
      lines.push(`${BLD}Role:${R} ${context.fileContext.role}`);
    }
    lines.push("");
  }

  if (diagnostics.length === 0) {
    lines.push(`  ${GRN}✓${R}  no diagnostics`);
    lines.push("");
    return lines.join("\n");
  }

  for (const d of diagnostics) {
    const color = d.level === "error" ? RED : YEL;
    lines.push(`  ${color}${d.level}${R} ${DIM}[${d.code}]${R} ${d.message}`);
    const importedModule = (d as { imported_module?: string }).imported_module;
    if (importedModule) {
      lines.push(`    ${DIM}imports ${importedModule}${R}`);
    }
    if (d.hint) lines.push(`    ${DIM}${d.hint}${R}`);
    if (d.remediation) {
      lines.push(`    ${DIM}remediation: ${d.remediation.kind}${R}`);
    }
  }

  lines.push("");
  const errors = diagnostics.filter((d) => d.level === "error");
  const warnings = diagnostics.filter((d) => d.level === "warning");
  if (errors.length > 0) {
    const w = warnings.length ? `, ${warnings.length} warning(s)` : "";
    lines.push(`${RED}${BLD}${errors.length} error${errors.length !== 1 ? "s" : ""}${w}${R}`);
  } else {
    lines.push(`${YEL}${BLD}${warnings.length} warning${warnings.length !== 1 ? "s" : ""}${R}`);
  }
  lines.push("");
  return lines.join("\n");
}
