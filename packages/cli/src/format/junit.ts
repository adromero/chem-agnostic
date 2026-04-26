// ---------------------------------------------------------------------------
// JUnit XML formatter — emits a single `<testsuite>` per invocation with one
// `<testcase>` per compound (for check / analyze) or per file (for
// check-edit). Workspace-level diagnostics bucket into a synthetic
// `<testcase classname="<workspace>" name="workspace">`.
//
// Validation strategy (wp-005 spec § "JUnit validation"):
//   - We deliberately SKIP strict XSD validation. The JUnit XSD ecosystem
//     is fragmented (Jenkins, Surefire, Ant variants disagree); strict
//     validation would be brittle.
//   - Tests use `fast-xml-parser` to assert the document's structural
//     invariants (one <testsuite>, valid attributes, failure counts
//     match, etc.). Full XSD validation can be revisited if a real CI
//     consumer requests it.
//
// Failure vs system-out:
//   - Errors render as `<failure type="<code>" message="<short>">…</failure>`.
//     Multiple errors on the same testcase produce multiple <failure>
//     siblings (permitted by the JUnit XSD used by Jenkins/CircleCI/GitLab).
//   - Warnings render as `<system-out>` text inside the testcase. This
//     means warnings DO NOT fail the CI gate — a deliberate decision so
//     informational diagnostics don't break builds.
// ---------------------------------------------------------------------------

import type { Diagnostic } from "@chemag/core/types";
import type { FormatContext } from "./index.js";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function formatJunit(diagnostics: Diagnostic[], context: FormatContext): string {
  const suiteName = context.workspaceName ?? "workspace";
  const cases = buildTestCases(diagnostics, context, suiteName);

  let totalFailures = 0;
  let totalErrors = 0;
  for (const c of cases) {
    if (c.failures.length > 0) totalFailures += c.failures.length;
  }

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuite name="${xmlAttr(suiteName)}" tests="${cases.length}" failures="${totalFailures}" errors="${totalErrors}">`,
  );
  for (const c of cases) {
    renderTestCase(c, lines);
  }
  lines.push("</testsuite>");
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Test-case construction
// ---------------------------------------------------------------------------

interface TestCase {
  classname: string;
  name: string;
  failures: { type: string; message: string; body: string }[];
  systemOut: string[];
}

function buildTestCases(
  diagnostics: Diagnostic[],
  context: FormatContext,
  suiteName: string,
): TestCase[] {
  if (context.command === "check-edit") {
    return buildCheckEditCases(diagnostics, context, suiteName);
  }
  return buildCompoundCases(diagnostics, context, suiteName);
}

function buildCheckEditCases(
  diagnostics: Diagnostic[],
  context: FormatContext,
  suiteName: string,
): TestCase[] {
  const file = context.fileContext?.file ?? "(unknown file)";
  const tc: TestCase = { classname: suiteName, name: file, failures: [], systemOut: [] };
  for (const d of diagnostics) {
    appendDiagnostic(tc, d);
  }
  return [tc];
}

function buildCompoundCases(
  diagnostics: Diagnostic[],
  context: FormatContext,
  suiteName: string,
): TestCase[] {
  // Group by Diagnostic.compound. Workspace-level (no compound) bucket into
  // the synthetic "workspace" testcase. We always emit the workspace
  // testcase for `check` so CI dashboards see consistent counts; we skip
  // it for `analyze` (which is always compound-scoped) when empty.
  const compounds = new Map<string, TestCase>();
  let workspaceCase: TestCase | null = null;
  const ensureWorkspaceCase = (): TestCase => {
    if (!workspaceCase) {
      workspaceCase = {
        classname: suiteName,
        name: "workspace",
        failures: [],
        systemOut: [],
      };
    }
    return workspaceCase;
  };

  for (const d of diagnostics) {
    if (d.compound) {
      let tc = compounds.get(d.compound);
      if (!tc) {
        tc = { classname: suiteName, name: d.compound, failures: [], systemOut: [] };
        compounds.set(d.compound, tc);
      }
      appendDiagnostic(tc, d);
    } else {
      appendDiagnostic(ensureWorkspaceCase(), d);
    }
  }

  // If the command is `check`, always include the workspace testcase even
  // when empty so CI sees a stable per-suite layout. `analyze` only injects
  // it when there's actually a workspace-level diagnostic (rare but
  // possible if a future check ever surfaces one).
  if (context.command === "check" && !workspaceCase) {
    workspaceCase = {
      classname: suiteName,
      name: "workspace",
      failures: [],
      systemOut: [],
    };
  }

  const out: TestCase[] = [];
  if (workspaceCase) out.push(workspaceCase);
  for (const tc of compounds.values()) out.push(tc);
  return out;
}

function appendDiagnostic(tc: TestCase, d: Diagnostic): void {
  if (d.level === "error") {
    tc.failures.push({
      type: d.code,
      message: shortMessage(d),
      body: bodyText(d),
    });
  } else {
    tc.systemOut.push(`[${d.code}] ${stripAnsi(d.message)}`);
  }
}

function shortMessage(d: Diagnostic): string {
  // Trim to a single line; some checks include hints that are long.
  const m = stripAnsi(d.message);
  const idx = m.indexOf("\n");
  return idx === -1 ? m : m.slice(0, idx);
}

function bodyText(d: Diagnostic): string {
  const parts: string[] = [stripAnsi(d.message)];
  if (d.hint) parts.push(stripAnsi(d.hint));
  if (d.file) parts.push(`file: ${d.file}`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderTestCase(tc: TestCase, lines: string[]): void {
  if (tc.failures.length === 0 && tc.systemOut.length === 0) {
    lines.push(`  <testcase classname="${xmlAttr(tc.classname)}" name="${xmlAttr(tc.name)}"/>`);
    return;
  }

  lines.push(`  <testcase classname="${xmlAttr(tc.classname)}" name="${xmlAttr(tc.name)}">`);
  for (const f of tc.failures) {
    lines.push(
      `    <failure type="${xmlAttr(f.type)}" message="${xmlAttr(f.message)}">${xmlText(f.body)}</failure>`,
    );
  }
  if (tc.systemOut.length > 0) {
    lines.push(`    <system-out>${xmlText(tc.systemOut.join("\n"))}</system-out>`);
  }
  lines.push("  </testcase>");
}

// ---------------------------------------------------------------------------
// Escaping helpers
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function xmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ");
}

function xmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
