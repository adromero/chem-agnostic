import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetForTesting, setVocabulary } from "../../src/vocabulary/index.js";
import { buildRulesContent, emitCursorMdc } from "../../src/rules-emitters/index.js";
import { buildFixtureCompounds, buildFixtureWorkspace } from "./_fixtures.js";

beforeEach(() => __resetForTesting());
afterEach(() => __resetForTesting());

describe("emitCursorMdc", () => {
  it("writes to .cursor/rules/architecture.mdc with frontmatter (standard)", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitCursorMdc(content);
    expect(file.path).toBe(".cursor/rules/architecture.mdc");
    expect(file.body).toMatch(/^---/);
    expect(file.body).toContain("alwaysApply: true");
    expect(file.body).toMatchSnapshot();
  });

  it("writes deterministic content under the chemistry vocab", () => {
    setVocabulary("chemistry", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitCursorMdc(content);
    expect(file.body).toMatchSnapshot();
  });
});
