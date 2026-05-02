// ---------------------------------------------------------------------------
// Per-emitter line-budget tests. The chemag block must fit within these
// budgets; the budget excludes content outside the markers (plugin language
// section, violations).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetForTesting, setVocabulary } from "../../src/vocabulary/index.js";
import {
  buildRulesContent,
  emitAgentsMd,
  emitAiderConventions,
  emitClaudeMd,
  emitClineRules,
  emitCopilotInstructions,
  emitCursorMdc,
  MARKER_END,
  MARKER_START,
} from "../../src/rules-emitters/index.js";
import { buildFixtureCompounds, buildFixtureWorkspace } from "./_fixtures.js";

beforeEach(() => __resetForTesting());
afterEach(() => __resetForTesting());

/** Count lines between MARKER_START and MARKER_END (inclusive of both markers). */
function chemagBlockLines(body: string): number {
  const start = body.indexOf(MARKER_START);
  const end = body.indexOf(MARKER_END);
  if (start === -1 || end === -1) {
    throw new Error("emitted body lacks chemag markers");
  }
  const block = body.slice(start, end + MARKER_END.length);
  return block.split("\n").length;
}

describe("budget — AGENTS.md ≤80 lines", () => {
  it("standard vocab", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitAgentsMd(content);
    expect(file.warnings).toEqual([]);
    expect(chemagBlockLines(file.body)).toBeLessThanOrEqual(80);
  });
  it("chemistry vocab", () => {
    setVocabulary("chemistry", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitAgentsMd(content);
    expect(file.warnings).toEqual([]);
    expect(chemagBlockLines(file.body)).toBeLessThanOrEqual(80);
  });
});

describe("budget — CLAUDE.md ≤80 lines (excluding plugin section)", () => {
  it("standard vocab", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitClaudeMd(content); // no pluginContent
    expect(file.warnings).toEqual([]);
    expect(chemagBlockLines(file.body)).toBeLessThanOrEqual(80);
  });
});

describe("budget — Cursor MDC body ≤60 lines", () => {
  it("standard vocab", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitCursorMdc(content);
    expect(file.warnings).toEqual([]);
    expect(chemagBlockLines(file.body)).toBeLessThanOrEqual(60);
  });
});

describe("budget — Copilot ≤40 lines", () => {
  it("standard vocab", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitCopilotInstructions(content);
    expect(file.warnings).toEqual([]);
    expect(chemagBlockLines(file.body)).toBeLessThanOrEqual(40);
  });
});

describe("budget — Aider + Cline ≤80 lines", () => {
  it("aider standard vocab", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitAiderConventions(content);
    expect(file.warnings).toEqual([]);
    expect(chemagBlockLines(file.body)).toBeLessThanOrEqual(80);
  });
  it("cline standard vocab", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitClineRules(content);
    expect(file.warnings).toEqual([]);
    expect(chemagBlockLines(file.body)).toBeLessThanOrEqual(80);
  });
});

describe("budget enforcement — too-tight budget surfaces a warning", () => {
  it("AGENTS.md emits a budget-exceeded warning when budget is impossibly tight", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const file = emitAgentsMd(content, { maxLines: 5 });
    expect(file.warnings.length).toBeGreaterThan(0);
    expect(file.warnings[0]).toContain("agents");
  });
});

describe("parity — AGENTS.md and CLAUDE.md share core sections", () => {
  it("the architecture summary, dependency table, and cross-module rule are byte-identical", () => {
    setVocabulary("standard", "flag");
    const content = buildRulesContent(buildFixtureWorkspace(), buildFixtureCompounds());
    const agents = emitAgentsMd(content);
    const claude = emitClaudeMd(content); // no pluginContent so we compare apples-to-apples

    // Both bodies contain the architecture summary, dependency table, and
    // cross-module rule produced from the same RulesContent object — they
    // come from the same builder so the substrings must match.
    expect(agents.body).toContain(content.architectureSummary);
    expect(claude.body).toContain(content.architectureSummary);
    expect(agents.body).toContain(content.dependencyRulesTable);
    expect(claude.body).toContain(content.dependencyRulesTable);
    expect(agents.body).toContain(content.crossModuleRule);
    expect(claude.body).toContain(content.crossModuleRule);
  });
});
