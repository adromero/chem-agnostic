import { describe, it, expect } from "vitest";
import { checkPrereqs, REQUIREMENTS } from "./check-prereqs.js";

describe("check-prereqs", () => {
  it("by default checks nothing — Track 0/1 has no external prereqs", () => {
    const result = checkPrereqs({ env: {} });
    expect(result.ok).toBe(true);
    expect(result.checked).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it("--all surfaces every missing required env var", () => {
    const result = checkPrereqs({ all: true, env: {} });
    expect(result.ok).toBe(false);
    expect(result.checked.length).toBe(REQUIREMENTS.length);
    expect(result.missing.length).toBe(REQUIREMENTS.length);
  });

  it("--stage filters to one stage", () => {
    const result = checkPrereqs({ stage: "auth", env: {} });
    expect(result.ok).toBe(false);
    expect(result.checked.every((r) => r.stage === "auth")).toBe(true);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it("treats empty string as missing", () => {
    const env: NodeJS.ProcessEnv = {};
    for (const req of REQUIREMENTS) env[req.envVar] = "";
    const result = checkPrereqs({ all: true, env });
    expect(result.missing.length).toBe(REQUIREMENTS.length);
  });

  it("passes when every required key is set for the selected stage", () => {
    const env: NodeJS.ProcessEnv = {};
    for (const req of REQUIREMENTS) {
      if (req.stage === "billing") env[req.envVar] = "set";
    }
    const result = checkPrereqs({ stage: "billing", env });
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("each requirement carries a wp tag pointing at a real WP", () => {
    for (const req of REQUIREMENTS) {
      expect(req.wp).toMatch(/^WP-\d{3}$/);
      expect(req.envVar).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(req.description.length).toBeGreaterThan(0);
    }
  });

  it("env var names are unique across requirements", () => {
    const seen = new Set<string>();
    for (const req of REQUIREMENTS) {
      expect(seen.has(req.envVar)).toBe(false);
      seen.add(req.envVar);
    }
  });
});
