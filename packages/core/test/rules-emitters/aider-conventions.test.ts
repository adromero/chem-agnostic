import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetForTesting, setVocabulary } from "../../src/vocabulary/index.js";
import { buildRulesContent, emitAiderConventions } from "../../src/rules-emitters/index.js";
import { buildFixtureCompounds, buildFixtureWorkspace } from "./_fixtures.js";

beforeEach(() => __resetForTesting());
afterEach(() => __resetForTesting());

describe("emitAiderConventions", () => {
  it("writes to .aider/CONVENTIONS.md ending with an Aider behavior section", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitAiderConventions(content);
    expect(file.path).toBe(".aider/CONVENTIONS.md");
    expect(file.body).toContain("## Aider behavior");
    expect(file.body).toMatchSnapshot();
  });

  it("writes deterministic content under the chemistry vocab", () => {
    setVocabulary("chemistry", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitAiderConventions(content);
    expect(file.body).toMatchSnapshot();
  });
});
