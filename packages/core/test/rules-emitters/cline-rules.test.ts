import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetForTesting, setVocabulary } from "../../src/vocabulary/index.js";
import { buildRulesContent, emitClineRules } from "../../src/rules-emitters/index.js";
import { buildFixtureCompounds, buildFixtureWorkspace } from "./_fixtures.js";

beforeEach(() => __resetForTesting());
afterEach(() => __resetForTesting());

describe("emitClineRules", () => {
  it("writes to .clinerules with deterministic content (standard)", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitClineRules(content);
    expect(file.path).toBe(".clinerules");
    expect(file.body).toMatchSnapshot();
  });

  it("writes deterministic content under the chemistry vocab", () => {
    setVocabulary("chemistry", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitClineRules(content);
    expect(file.body).toMatchSnapshot();
  });
});
