import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetForTesting, setVocabulary } from "../../src/vocabulary/index.js";
import { buildRulesContent, emitClaudeMd } from "../../src/rules-emitters/index.js";
import { buildFixtureCompounds, buildFixtureWorkspace } from "./_fixtures.js";

beforeEach(() => __resetForTesting());
afterEach(() => __resetForTesting());

const MOCK_PLUGIN_OUTPUT = `## Roles — What Each Unit Type Means

(core heading — should be filtered out)

## Cross-Compound Imports (TypeScript)

- ALWAYS import through public.ts.
`;

describe("emitClaudeMd", () => {
  it("writes to CLAUDE.md with deterministic content (standard vocab)", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitClaudeMd(content, { pluginContent: MOCK_PLUGIN_OUTPUT });
    expect(file.path).toBe("CLAUDE.md");
    expect(file.body).toMatchSnapshot();
  });

  it("writes deterministic content under the chemistry vocab", () => {
    setVocabulary("chemistry", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitClaudeMd(content, { pluginContent: MOCK_PLUGIN_OUTPUT });
    expect(file.body).toMatchSnapshot();
  });

  it("filters core headings out of pluginContent", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitClaudeMd(content, { pluginContent: MOCK_PLUGIN_OUTPUT });
    // The "Roles — What Each Unit Type Means" heading is in CORE_HEADINGS so
    // its body should be dropped.
    expect(file.body).not.toContain("(core heading — should be filtered out)");
    // The TypeScript-specific section survives.
    expect(file.body).toContain("Cross-Compound Imports (TypeScript)");
  });

  it("emits without a pluginContent argument (no language section)", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitClaudeMd(content);
    expect(file.body).toContain("Architecture summary");
    expect(file.body).not.toContain("Cross-Compound Imports");
  });
});
