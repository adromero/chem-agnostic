import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetForTesting, setVocabulary } from "../../src/vocabulary/index.js";
import { buildRulesContent, emitCopilotInstructions } from "../../src/rules-emitters/index.js";
import { buildFixtureCompounds, buildFixtureWorkspace } from "./_fixtures.js";

beforeEach(() => __resetForTesting());
afterEach(() => __resetForTesting());

describe("emitCopilotInstructions", () => {
  it("writes to .github/copilot-instructions.md with the tightest budget", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitCopilotInstructions(content);
    expect(file.path).toBe(".github/copilot-instructions.md");
    expect(file.body).toMatchSnapshot();
  });

  it("writes deterministic content under the chemistry vocab", () => {
    setVocabulary("chemistry", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitCopilotInstructions(content);
    expect(file.body).toMatchSnapshot();
  });
});
