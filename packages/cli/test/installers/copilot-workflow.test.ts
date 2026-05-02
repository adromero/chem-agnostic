// ---------------------------------------------------------------------------
// Tests for the GitHub Action workflow template emitted by the Copilot
// installer.
//
// These run on the YAML body itself (no fs setup needed): we parse the
// template via the `yaml` library that is already a dependency of the CLI
// package, then assert structural shape and that the expected chemag
// invocations are present.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";
import { CHEMAG_PR_WORKFLOW_HEADER } from "../../src/installers/copilot.js";

function loadTemplate(): string {
  // Locate the .tpl in src/. (Tests run via vitest aliases — no dist build.)
  const tplPath = path.resolve(__dirname, "../../src/installers/scripts/chemag-pr.yml.tpl");
  return fs.readFileSync(tplPath, "utf-8");
}

describe("chemag-pr.yml.tpl — chemag-managed header", () => {
  it("starts with the chemag-managed header line", () => {
    const tpl = loadTemplate();
    expect(tpl.startsWith(CHEMAG_PR_WORKFLOW_HEADER)).toBe(true);
  });
});

describe("chemag-pr.yml.tpl — structurally valid YAML", () => {
  it("parses as YAML", () => {
    const tpl = loadTemplate();
    const parsed = yamlParse(tpl) as Record<string, unknown>;
    expect(parsed).toBeTypeOf("object");
    expect(parsed).not.toBeNull();
  });

  it("has top-level keys: name, on, jobs", () => {
    const tpl = loadTemplate();
    const parsed = yamlParse(tpl) as Record<string, unknown>;
    expect(parsed).toHaveProperty("name");
    // YAML parses bare `on:` as the boolean `true` because of the YAML 1.1
    // legacy boolean alias. We accept either form (the GitHub Actions
    // schema accepts the bare key but yaml@2 reads it back as `true`).
    const keys = Object.keys(parsed);
    expect(keys.includes("on") || keys.includes("true")).toBe(true);
    expect(parsed).toHaveProperty("jobs");
  });

  it("declares a job that runs `chemag check` and `chemag analyze`", () => {
    const tpl = loadTemplate();
    const parsed = yamlParse(tpl) as { jobs?: Record<string, unknown> };
    expect(parsed.jobs).toBeDefined();
    const jobs = parsed.jobs ?? {};
    const jobNames = Object.keys(jobs);
    expect(jobNames.length).toBeGreaterThan(0);

    // Pull the first job's steps.
    const firstJob = jobs[jobNames[0]] as { steps?: Array<{ run?: string; name?: string }> };
    expect(firstJob.steps).toBeDefined();
    const allRuns = (firstJob.steps ?? [])
      .map((s) => s.run ?? "")
      .filter((s) => s.length > 0)
      .join("\n");
    expect(allRuns).toContain("chemag check");
    expect(allRuns).toContain("chemag analyze");
  });

  it("triggers on pull_request to main", () => {
    const tpl = loadTemplate();
    const parsed = yamlParse(tpl) as Record<string, unknown>;
    // YAML 1.1 may map `on` → `true`; check both.
    const onValue = (parsed.on ?? parsed.true) as { pull_request?: { branches?: string[] } };
    expect(onValue).toBeDefined();
    expect(onValue.pull_request).toBeDefined();
    expect(onValue.pull_request?.branches).toContain("main");
  });
});
