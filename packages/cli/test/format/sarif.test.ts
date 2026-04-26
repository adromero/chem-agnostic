// ---------------------------------------------------------------------------
// Tests for the SARIF 2.1.0 emitter. Validates against the vendored schema
// at packages/core/schemas/sarif-2.1.0.schema.json via ajv.
// ---------------------------------------------------------------------------
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { DIAGNOSTIC_CODES } from "@chemag/core/diagnostics";
import { VERSION } from "../../src/version.js";
import {
  buildSarifLog,
  formatSarif,
  TOOL_INFORMATION_URI,
  type SarifLog,
} from "../../src/format/sarif.js";
import {
  makeCheckContext,
  oneOfEachDiagnostic,
  sourceLevelDiag,
  workspaceLevelDiag,
} from "./fixtures.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const SARIF_SCHEMA_PATH = path.resolve(repoRoot, "packages/core/schemas/sarif-2.1.0.schema.json");

/**
 * Build a SARIF-flavoured ajv instance. The vendored SARIF schema declares
 * `$schema: http://json-schema.org/draft-07/schema#`. ajv-formats supplies
 * the `uri` / `uri-reference` formats used throughout. We disable strict
 * mode because the SARIF schema uses some idioms (e.g. unconstrained
 * `additionalProperties`) that ajv strict-mode flags as warnings.
 */
function ajvForSarif() {
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    validateFormats: true,
  });
  addFormats(ajv);
  const schema = JSON.parse(fs.readFileSync(SARIF_SCHEMA_PATH, "utf-8"));
  const validate = ajv.compile(schema);
  return {
    validate: (data: unknown) => validate(data) as boolean,
    errorsText: () => ajv.errorsText(validate.errors),
  };
}

// ---------------------------------------------------------------------------
// Shape assertions
// ---------------------------------------------------------------------------

describe("format/sarif — log shape", () => {
  it("declares SARIF 2.1.0 with the canonical $schema URL", () => {
    const log: SarifLog = buildSarifLog([], makeCheckContext());
    expect(log.version).toBe("2.1.0");
    expect(log.$schema).toMatch(/sarif-schema-2\.1\.0/);
    expect(log.runs).toHaveLength(1);
  });

  it("tool.driver.name is 'chemag' and version equals VERSION", () => {
    const log = buildSarifLog([], makeCheckContext({ toolVersion: VERSION }));
    const driver = log.runs[0].tool.driver;
    expect(driver.name).toBe("chemag");
    expect(driver.version).toBe(VERSION);
  });

  it("tool.driver.informationUri is the chemag-org repo URL (no TBD regression)", () => {
    const log = buildSarifLog([], makeCheckContext());
    const uri = log.runs[0].tool.driver.informationUri;
    expect(uri).toBe(TOOL_INFORMATION_URI);
    expect(uri).toBe("https://github.com/chemag-org/chemag");
    expect(uri).toMatch(/^https?:\/\//);
  });

  it("emits one rule per DIAGNOSTIC_CODES entry", () => {
    const log = buildSarifLog([], makeCheckContext());
    const rules = log.runs[0].tool.driver.rules;
    expect(rules.length).toBe(Object.keys(DIAGNOSTIC_CODES).length);
    const ids = new Set(rules.map((r) => r.id));
    for (const k of Object.keys(DIAGNOSTIC_CODES)) {
      expect(ids.has(k)).toBe(true);
    }
  });

  it("rule names are PascalCase (e.g. ChemBond001)", () => {
    const log = buildSarifLog([], makeCheckContext());
    const rule = log.runs[0].tool.driver.rules.find((r) => r.id === "CHEM-BOND-001");
    expect(rule).toBeDefined();
    expect(rule?.name).toBe("ChemBond001");
  });
});

describe("format/sarif — result location handling", () => {
  it("source-level diagnostic produces a physicalLocation with relative URI", () => {
    const log = buildSarifLog([sourceLevelDiag()], makeCheckContext());
    const result = log.runs[0].results[0];
    expect(result.locations.length).toBe(1);
    const uri = result.locations[0].physicalLocation.artifactLocation.uri;
    // workspacePath is /home/work/myrepo, file is .../createOrder.ts under it.
    expect(uri).toBe("src/compounds/orders/reactions/createOrder.ts");
  });

  it("workspace-level diagnostic emits locations: []", () => {
    const log = buildSarifLog([workspaceLevelDiag()], makeCheckContext());
    const result = log.runs[0].results[0];
    expect(result.locations).toEqual([]);
  });

  it("absolute path outside the workspace is emitted as a file:// URI", () => {
    const ctx = makeCheckContext({ workspacePath: "/home/work/myrepo" });
    const log = buildSarifLog([{ ...sourceLevelDiag(), file: "/elsewhere/foo.ts" }], ctx);
    const uri = log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
    expect(uri).toMatch(/^file:\/\//);
  });
});

describe("format/sarif — properties bag", () => {
  it("attaches the check name and compound to result.properties", () => {
    const log = buildSarifLog([sourceLevelDiag()], makeCheckContext());
    const result = log.runs[0].results[0];
    expect(result.properties.check).toBe("import-bonds");
    expect(result.properties.compound).toBe("orders");
  });
});

describe("format/sarif — schema validation", () => {
  const { validate, errorsText } = ajvForSarif();

  it("validates an empty diagnostic set against the vendored SARIF schema", () => {
    const log = buildSarifLog([], makeCheckContext());
    const ok = validate(log);
    if (!ok) console.error("ajv errors:", errorsText());
    expect(ok).toBe(true);
  });

  it("validates a mixed set (source + workspace + warning)", () => {
    const diags = [sourceLevelDiag(), workspaceLevelDiag()];
    const log = buildSarifLog(diags, makeCheckContext());
    const ok = validate(log);
    if (!ok) console.error("ajv errors:", errorsText());
    expect(ok).toBe(true);
  });

  it("validates one result per registry code (registry coverage)", () => {
    const diags = oneOfEachDiagnostic();
    const log = buildSarifLog(diags, makeCheckContext());
    const ok = validate(log);
    if (!ok) console.error("ajv errors:", errorsText());
    expect(ok).toBe(true);
  });

  it("formatSarif output is valid JSON ending in newline", () => {
    const text = formatSarif([sourceLevelDiag()], makeCheckContext());
    expect(text.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe("2.1.0");
  });
});
