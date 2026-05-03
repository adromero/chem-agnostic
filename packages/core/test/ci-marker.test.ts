// ---------------------------------------------------------------------------
// Tests for the shared CI sticky-comment marker. The constant + helpers are
// re-exported by every CI integration (GitHub Action's comment.ts, the CLI's
// ci/gitlab.ts module, and — wp-025 — the Bitbucket poster), so any change
// here is a cross-cutting compatibility break: every chemag-managed comment
// ever written has the marker on line one.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { STICKY_MARKER, hasMarker, wrapWithMarker } from "@chemag/core/ci-marker";

describe("ci-marker — STICKY_MARKER constant", () => {
  it("is the byte-stable hidden HTML comment", () => {
    // Treat this as a stability test: changing the marker would orphan every
    // existing chemag comment and start posting duplicates.
    expect(STICKY_MARKER).toBe("<!-- chemag:comment -->");
  });
});

describe("ci-marker — hasMarker", () => {
  it("matches a body whose first line is the marker", () => {
    expect(hasMarker(`${STICKY_MARKER}\nbody`)).toBe(true);
  });

  it("matches a body that is just the marker", () => {
    expect(hasMarker(STICKY_MARKER)).toBe(true);
  });

  it("matches a body with leading whitespace before the marker", () => {
    expect(hasMarker(`  ${STICKY_MARKER}\nbody`)).toBe(true);
  });

  it("matches a body with a leading BOM (web editor round-trip)", () => {
    expect(hasMarker(`﻿${STICKY_MARKER}\nbody`)).toBe(true);
  });

  it("does not match the marker mid-body", () => {
    expect(hasMarker(`hello\n${STICKY_MARKER}\nworld`)).toBe(false);
  });

  it("rejects unrelated bodies", () => {
    expect(hasMarker("just a plain user comment")).toBe(false);
    expect(hasMarker("")).toBe(false);
  });
});

describe("ci-marker — wrapWithMarker", () => {
  it("prepends the marker on a fresh body", () => {
    const out = wrapWithMarker("hello");
    expect(out.startsWith(`${STICKY_MARKER}\n`)).toBe(true);
    expect(out.endsWith("hello")).toBe(true);
  });

  it("is idempotent: a second wrap is a no-op", () => {
    const once = wrapWithMarker("hello");
    const twice = wrapWithMarker(once);
    expect(twice).toBe(once);
    // Marker must appear exactly once.
    const occurrences = twice.split(STICKY_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });

  it("does not double-prepend when the body has the marker mid-stream", () => {
    // hasMarker checks first-line only, so a body that mentions the marker
    // later still gets the marker prepended (this is correct behavior — the
    // mid-stream mention is treated as user content, not a sentinel).
    const out = wrapWithMarker(`leading\n${STICKY_MARKER}`);
    expect(out.split(STICKY_MARKER).length - 1).toBe(2);
    expect(out.startsWith(`${STICKY_MARKER}\n`)).toBe(true);
  });

  it("preserves a body that already starts with the marker after whitespace", () => {
    // hasMarker is whitespace-tolerant, so wrapWithMarker should NOT add a
    // second marker just because the existing one is indented.
    const body = `  ${STICKY_MARKER}\nx`;
    expect(wrapWithMarker(body)).toBe(body);
  });
});
