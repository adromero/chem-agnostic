// ---------------------------------------------------------------------------
// Tests for `rules-emitters/markers.ts`. Verifies idempotent merge: manual
// content outside markers survives a re-run, and missing-markers without
// --overwrite throws MarkersMissingError.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  MARKER_END,
  MARKER_START,
  MarkersMissingError,
  mergeBetweenMarkers,
  wrapWithMarkers,
} from "../../src/rules-emitters/markers.js";

describe("wrapWithMarkers", () => {
  it("wraps a block with start/end markers and trims accidental newlines", () => {
    const out = wrapWithMarkers("\n\nbody\n\n");
    expect(out).toBe(`${MARKER_START}\nbody\n${MARKER_END}`);
  });
});

describe("mergeBetweenMarkers — first write", () => {
  it("returns the wrapped block plus a single trailing newline when existing is null", () => {
    const block = wrapWithMarkers("hello");
    const result = mergeBetweenMarkers(null, block, { overwrite: false, isMdc: false });
    expect(result.body).toBe(`${block}\n`);
    expect(result.warnings).toEqual([]);
  });
});

describe("mergeBetweenMarkers — re-run preserves manual content", () => {
  it("keeps manual content before AND after the markers verbatim", () => {
    const oldBlock = wrapWithMarkers("OLD body");
    const existing = `# user note before\n\n${oldBlock}\n\n# user note after\n`;
    const newBlock = wrapWithMarkers("NEW body");

    const result = mergeBetweenMarkers(existing, newBlock, { overwrite: false, isMdc: false });

    expect(result.body).toContain("# user note before");
    expect(result.body).toContain("# user note after");
    expect(result.body).toContain("NEW body");
    expect(result.body).not.toContain("OLD body");
    expect(result.warnings).toEqual([]);
  });

  it("is byte-for-byte idempotent across two consecutive runs", () => {
    const block = wrapWithMarkers("body");
    const first = mergeBetweenMarkers(null, block, { overwrite: false, isMdc: false });
    const second = mergeBetweenMarkers(first.body, block, { overwrite: false, isMdc: false });
    expect(second.body).toBe(first.body);
  });
});

describe("mergeBetweenMarkers — markers absent", () => {
  it("throws MarkersMissingError when overwrite is false", () => {
    const existing = "# unrelated content\n";
    const block = wrapWithMarkers("body");
    expect(() => mergeBetweenMarkers(existing, block, { overwrite: false, isMdc: false })).toThrow(
      MarkersMissingError,
    );
  });

  it("replaces the file wholesale and warns when overwrite is true", () => {
    const existing = "# unrelated content\n";
    const block = wrapWithMarkers("body");
    const result = mergeBetweenMarkers(existing, block, { overwrite: true, isMdc: false });
    expect(result.body).toContain("body");
    expect(result.body).not.toContain("# unrelated content");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("mergeBetweenMarkers — MDC mode", () => {
  it("regenerates frontmatter on every run while preserving body content", () => {
    const oldFile = [
      "---",
      "description: OLD",
      "globs:",
      '  - "src/**/*"',
      "alwaysApply: true",
      "---",
      "# user note before",
      "",
      MARKER_START,
      "OLD body",
      MARKER_END,
      "# user note after",
    ].join("\n");

    const newFrontmatter = [
      "---",
      "description: NEW",
      "globs:",
      '  - "src/**/*"',
      "alwaysApply: true",
      "---",
    ].join("\n");
    const newBlock = wrapWithMarkers("NEW body");

    const result = mergeBetweenMarkers(oldFile, newBlock, {
      overwrite: false,
      isMdc: true,
      leading: newFrontmatter,
    });
    expect(result.body).toContain("description: NEW");
    expect(result.body).not.toContain("description: OLD");
    expect(result.body).toContain("# user note before");
    expect(result.body).toContain("# user note after");
    expect(result.body).toContain("NEW body");
    expect(result.body).not.toContain("OLD body");
  });
});
