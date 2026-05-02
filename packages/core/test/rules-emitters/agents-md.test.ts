import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetForTesting, setVocabulary } from "../../src/vocabulary/index.js";
import { buildRulesContent, emitAgentsMd } from "../../src/rules-emitters/index.js";
import { buildFixtureCompounds, buildFixtureWorkspace } from "./_fixtures.js";

beforeEach(() => __resetForTesting());
afterEach(() => __resetForTesting());

describe("emitAgentsMd", () => {
  it("writes to AGENTS.md with deterministic content (standard vocab)", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitAgentsMd(content);
    expect(file.path).toBe("AGENTS.md");
    expect(file.body).toMatchSnapshot();
  });

  it("writes deterministic content under the chemistry vocab", () => {
    setVocabulary("chemistry", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitAgentsMd(content);
    expect(file.body).toMatchSnapshot();
  });

  it("includes a violations block when content.violations is set", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds(), {
      violations: [
        {
          level: "error",
          check: "bond-rules",
          code: "CHEM-BOND-002",
          message: "reaction depends on adapter",
          file: "src/compounds/billing/reactions/charge.ts",
        },
      ],
    });
    const file = emitAgentsMd(content);
    expect(file.body).toContain("Current violations");
    expect(file.body).toContain("CHEM-BOND-002");
    expect(file.body).toContain("fix me");
  });
});
