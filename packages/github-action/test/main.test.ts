import { describe, expect, it } from "vitest";
import { diagnosticsFromSarif, meetsThreshold, mergeSarif, parseInputs } from "../src/main";

function reader(values: Record<string, string>): (name: string) => string {
  return (name) => values[name] ?? "";
}

const minimalSarif = JSON.stringify({
  $schema:
    "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  version: "2.1.0",
  runs: [
    {
      tool: {
        driver: { name: "chemag", version: "0.1.0", informationUri: "https://example", rules: [] },
      },
      results: [
        {
          ruleId: "CHEM-BOND-001",
          level: "error",
          message: { text: "bond rule violated" },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/foo.ts" },
                region: { startLine: 12 },
              },
            },
          ],
          properties: { check: "bond-rules", compound: "billing" },
        },
        {
          ruleId: "CHEM-DUP-002",
          level: "warning",
          message: { text: "duplicate name" },
          properties: { check: "no-duplicates" },
        },
      ],
    },
  ],
});

describe("parseInputs", () => {
  it("returns defaults when every input is empty", () => {
    const inputs = parseInputs(reader({}));
    expect(inputs.workspace).toBe("workspace.yaml");
    expect(inputs.command).toBe("both");
    expect(inputs.failOn).toBe("error");
    expect(inputs.format).toBe("sarif");
    expect(inputs.commentMode).toBe("sticky");
    expect(inputs.changedOnly).toBe(true);
    expect(inputs.vocabulary).toBe("standard");
    expect(inputs.githubToken).toBe("");
  });

  it('rejects an unknown "fail-on" value with a clear error', () => {
    expect(() => parseInputs(reader({ "fail-on": "kaboom" }))).toThrowError(/Invalid "fail-on"/);
  });

  it('rejects an unknown "command" value', () => {
    expect(() => parseInputs(reader({ command: "scan-everything" }))).toThrowError(
      /Invalid "command"/,
    );
  });

  it('rejects a non-boolean "changed-only" value', () => {
    expect(() => parseInputs(reader({ "changed-only": "maybe" }))).toThrowError(
      /Invalid "changed-only"/,
    );
  });

  it("falls back to GITHUB_TOKEN env var when the input contains an unresolved expression", () => {
    const prev = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "env-token";
    try {
      const inputs = parseInputs(reader({ "github-token": "${{ github.token }}" }));
      expect(inputs.githubToken).toBe("env-token");
    } finally {
      if (prev === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = prev;
    }
  });

  it("uses the provided token verbatim when it doesn't look like an expression", () => {
    const inputs = parseInputs(reader({ "github-token": "ghp_real_token_123" }));
    expect(inputs.githubToken).toBe("ghp_real_token_123");
  });
});

describe("diagnosticsFromSarif", () => {
  it("flattens results into RenderableDiagnostic[]", () => {
    const diags = diagnosticsFromSarif(minimalSarif);
    expect(diags).toHaveLength(2);
    expect(diags[0]).toEqual({
      level: "error",
      code: "CHEM-BOND-001",
      message: "bond rule violated",
      file: "src/foo.ts",
      line: 12,
      compound: "billing",
    });
    expect(diags[1].level).toBe("warning");
    expect(diags[1].file).toBeUndefined();
  });

  it("treats unknown / missing levels as error (conservative)", () => {
    const sarif = JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "chemag", version: "0", informationUri: "x", rules: [] } },
          results: [{ ruleId: "X", message: { text: "y" } }],
        },
      ],
    });
    expect(diagnosticsFromSarif(sarif)[0].level).toBe("error");
  });
});

describe("mergeSarif", () => {
  it("concatenates results from two SARIF logs", () => {
    const a = minimalSarif;
    const b = JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: { name: "chemag", version: "0.1.0", informationUri: "x", rules: [] },
          },
          results: [
            { ruleId: "CHEM-IMPORT-001", level: "error", message: { text: "import wrong" } },
          ],
        },
      ],
    });
    const merged = JSON.parse(mergeSarif(a, b)) as {
      runs: [{ results: unknown[] }];
    };
    expect(merged.runs[0].results).toHaveLength(3);
  });
});

describe("meetsThreshold", () => {
  const errorDiag = { level: "error" as const, code: "X", message: "" };
  const warnDiag = { level: "warning" as const, code: "X", message: "" };

  it('returns false for "never" no matter what', () => {
    expect(meetsThreshold([errorDiag, warnDiag], "never")).toBe(false);
  });
  it('returns true for "warning" when there is at least one diagnostic of any level', () => {
    expect(meetsThreshold([warnDiag], "warning")).toBe(true);
    expect(meetsThreshold([errorDiag], "warning")).toBe(true);
    expect(meetsThreshold([], "warning")).toBe(false);
  });
  it('returns true for "error" only when there is at least one error', () => {
    expect(meetsThreshold([warnDiag], "error")).toBe(false);
    expect(meetsThreshold([errorDiag, warnDiag], "error")).toBe(true);
  });
});
