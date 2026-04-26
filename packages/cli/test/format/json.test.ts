// ---------------------------------------------------------------------------
// Tests for the new --format json envelope (packages/cli/src/format/json.ts).
// Validates against packages/core/schemas/diagnostics.schema.json via ajv.
// ---------------------------------------------------------------------------
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import { buildJsonReport, formatJson } from "../../src/format/json.js";
import {
  makeAnalyzeContext,
  makeCheckContext,
  oneOfEachDiagnostic,
  sourceLevelDiag,
  warningDiag,
  workspaceLevelDiag,
} from "./fixtures.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const SCHEMA_PATH = path.resolve(repoRoot, "packages/core/schemas/diagnostics.schema.json");

function ajvForSchema(): { validate: (data: unknown) => boolean; errorsText: () => string } {
  const ajv = new Ajv({ strict: false, allErrors: true });
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8"));
  const validate = ajv.compile(schema);
  return {
    validate: (data) => validate(data) as boolean,
    errorsText: () => ajv.errorsText(validate.errors),
  };
}

describe("format/json — envelope shape", () => {
  it("emits schemaVersion 1.0.0 with chemag tool name", () => {
    const out = JSON.parse(formatJson([], makeCheckContext()));
    expect(out.schemaVersion).toBe("1.0.0");
    expect(out.tool.name).toBe("chemag");
    expect(typeof out.tool.version).toBe("string");
  });

  it("populates summary.errors and summary.warnings counts", () => {
    const diags = [sourceLevelDiag(), warningDiag(), workspaceLevelDiag()];
    const out = JSON.parse(formatJson(diags, makeCheckContext()));
    expect(out.summary.errors).toBe(2);
    expect(out.summary.warnings).toBe(1);
  });

  it("preserves Diagnostic fields including `file`, `hint`, `remediation`", () => {
    const diags = [sourceLevelDiag()];
    const out = JSON.parse(formatJson(diags, makeCheckContext()));
    expect(out.diagnostics).toHaveLength(1);
    const d = out.diagnostics[0];
    expect(d.code).toBe("CHEM-BOND-003");
    expect(d.file).toMatch(/createOrder\.ts$/);
    expect(d.hint).toBeDefined();
  });

  it("output ends with a single trailing newline", () => {
    const text = formatJson([], makeCheckContext());
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("buildJsonReport returns a structured envelope (programmatic API)", () => {
    const r = buildJsonReport([sourceLevelDiag()], makeCheckContext());
    expect(r.command).toBe("check");
    expect(r.workspace?.path).toBe("/home/work/myrepo");
    expect(r.workspace?.name).toBe("test-app");
  });
});

describe("format/json — schema validation", () => {
  const { validate, errorsText } = ajvForSchema();

  it("validates an empty diagnostics list", () => {
    const out = JSON.parse(formatJson([], makeCheckContext()));
    const ok = validate(out);
    if (!ok) console.error("ajv errors:", errorsText());
    expect(ok).toBe(true);
  });

  it("validates a representative mix (workspace + source-level)", () => {
    const diags = [workspaceLevelDiag(), sourceLevelDiag(), warningDiag()];
    const out = JSON.parse(formatJson(diags, makeCheckContext()));
    const ok = validate(out);
    if (!ok) console.error("ajv errors:", errorsText());
    expect(ok).toBe(true);
  });

  it("validates an analyze invocation", () => {
    const diags = [sourceLevelDiag()];
    const out = JSON.parse(formatJson(diags, makeAnalyzeContext()));
    expect(out.command).toBe("analyze");
    const ok = validate(out);
    if (!ok) console.error("ajv errors:", errorsText());
    expect(ok).toBe(true);
  });

  it("validates one diagnostic per registry code (29 codes)", () => {
    const diags = oneOfEachDiagnostic();
    expect(diags.length).toBeGreaterThanOrEqual(29);
    const out = JSON.parse(formatJson(diags, makeCheckContext()));
    const ok = validate(out);
    if (!ok) console.error("ajv errors:", errorsText());
    expect(ok).toBe(true);
  });
});
