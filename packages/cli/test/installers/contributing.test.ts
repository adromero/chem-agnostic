// ---------------------------------------------------------------------------
// Tests for `_contributing.ts` — CONTRIBUTING.md chemag block management.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  CONTRIBUTING_MARKER_END,
  CONTRIBUTING_MARKER_START,
  applyChemagBlock,
  removeChemagBlock,
} from "../../src/installers/_contributing.js";

describe("applyChemagBlock — null existing", () => {
  it("creates a new file with default header + chemag block", () => {
    const result = applyChemagBlock(null);
    expect(result.changed).toBe(true);
    expect(result.body).toContain("# Contributing");
    expect(result.body).toContain(CONTRIBUTING_MARKER_START);
    expect(result.body).toContain(CONTRIBUTING_MARKER_END);
    expect(result.body).toContain("chemag");
  });
});

describe("applyChemagBlock — existing file without markers", () => {
  it("appends a fresh block, leaving manual content untouched", () => {
    const existing = "# My Project\n\nManual prose.\n";
    const result = applyChemagBlock(existing);
    expect(result.changed).toBe(true);
    expect(result.body.startsWith("# My Project")).toBe(true);
    expect(result.body).toContain("Manual prose.");
    expect(result.body).toContain(CONTRIBUTING_MARKER_START);
    expect(result.body).toContain(CONTRIBUTING_MARKER_END);
  });
});

describe("applyChemagBlock — existing file with markers (idempotence + spliced update)", () => {
  it("splices new content between markers, preserves manual content outside", () => {
    const existing = `# My Project

Manual top section.

${CONTRIBUTING_MARKER_START}
old chemag content
${CONTRIBUTING_MARKER_END}

Manual bottom section.
`;
    const result = applyChemagBlock(existing);
    expect(result.changed).toBe(true);
    expect(result.body).toContain("Manual top section.");
    expect(result.body).toContain("Manual bottom section.");
    expect(result.body).not.toContain("old chemag content");
    expect(result.body).toContain("chemag check-edit");
  });

  it("idempotence: applying twice produces byte-equal output", () => {
    const a = applyChemagBlock(null);
    const b = applyChemagBlock(a.body);
    expect(b.body).toBe(a.body);
    expect(b.changed).toBe(false);
  });
});

describe("removeChemagBlock", () => {
  it("removes the chemag block, preserving surrounding content", () => {
    const installed = applyChemagBlock("# Project\n\nIntro.\n");
    const removed = removeChemagBlock(installed.body);
    expect(removed.changed).toBe(true);
    expect(removed.body).not.toBeNull();
    expect(removed.body).toContain("Intro.");
    expect(removed.body).not.toContain(CONTRIBUTING_MARKER_START);
    expect(removed.body).not.toContain("chemag check-edit");
  });

  it("returns body=null when only the synthesized header remains", () => {
    const fresh = applyChemagBlock(null);
    const removed = removeChemagBlock(fresh.body);
    expect(removed.changed).toBe(true);
    expect(removed.body).toBeNull();
  });

  it("returns changed:false when no chemag block is present", () => {
    const before = "# Project\n\nNo chemag block here.\n";
    const result = removeChemagBlock(before);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(before);
  });
});
