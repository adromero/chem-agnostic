// ---------------------------------------------------------------------------
// CONTRIBUTING.md chemag block management.
//
// The Cursor installer (and any future installer that wants to add a doc
// note) writes a chemag-managed block delimited by:
//   <!-- chemag:contributing:start -->
//   <!-- chemag:contributing:end -->
// All content outside those markers is preserved verbatim across re-runs.
// All content inside the markers is fully owned by chemag.
//
// We intentionally use a different marker pair than the rules-emitter
// markers (`<!-- chemag:rules:start -->`) so a CONTRIBUTING.md cannot be
// confused with a rule file by automated tooling.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";

export const CONTRIBUTING_MARKER_START = "<!-- chemag:contributing:start -->";
export const CONTRIBUTING_MARKER_END = "<!-- chemag:contributing:end -->";

/** Default chemag block body (markdown). */
export const DEFAULT_CONTRIBUTING_BLOCK = [
  "## chemag — architecture validation",
  "",
  "This repository uses [chemag](https://github.com/anthropics/chemag) to enforce its module architecture.",
  "",
  "- After every meaningful edit, run `chemag check-edit <path>` for fast single-file feedback.",
  "- A pre-commit hook (`husky`) runs `chemag check --format human` on every commit.",
  "- Architecture rules live in `.cursor/rules/architecture.mdc` (regenerate with `chemag emit-rules --tool cursor`).",
].join("\n");

/** Synthesized header used when CONTRIBUTING.md does not exist. */
const DEFAULT_FILE_HEADER = "# Contributing\n\n";

export interface ContributingMergeResult {
  /** Final body to write. */
  body: string;
  /** True if the body differs from `existing` (or `existing` was null). */
  changed: boolean;
}

/**
 * Compute the post-merge body for CONTRIBUTING.md, splicing the chemag
 * block between the contributing markers. Idempotent: re-running over an
 * unchanged file produces a byte-equal result.
 */
export function applyChemagBlock(
  existing: string | null,
  blockBody: string = DEFAULT_CONTRIBUTING_BLOCK,
): ContributingMergeResult {
  const wrapped = wrap(blockBody);

  if (existing === null) {
    const body = `${DEFAULT_FILE_HEADER}${wrapped}\n`;
    return { body, changed: true };
  }

  const startIdx = existing.indexOf(CONTRIBUTING_MARKER_START);
  const endIdx = existing.indexOf(CONTRIBUTING_MARKER_END, startIdx >= 0 ? startIdx : 0);

  if (startIdx === -1 || endIdx === -1) {
    // Append a fresh block at the end of the file, leaving manual content
    // untouched. We add a single blank-line buffer so the appended block
    // doesn't bleed into existing prose.
    const trimmed = existing.replace(/\n+$/, "");
    const body = `${trimmed}\n\n${wrapped}\n`;
    if (body === existing) return { body, changed: false };
    return { body, changed: true };
  }

  // Splice the new block into the gap. Pre/post content is kept verbatim.
  const before = existing.slice(0, startIdx);
  const after = existing.slice(endIdx + CONTRIBUTING_MARKER_END.length);
  const body = `${before}${wrapped}${after}`;
  return { body, changed: body !== existing };
}

/**
 * Strip the chemag block (markers and contents). If the resulting file
 * holds only whitespace, returns `body: null` so the caller can decide to
 * delete it (chemag wrote it from scratch on install).
 */
export interface RemoveChemagBlockResult {
  body: string | null;
  changed: boolean;
}

export function removeChemagBlock(existing: string): RemoveChemagBlockResult {
  const startIdx = existing.indexOf(CONTRIBUTING_MARKER_START);
  const endIdx = existing.indexOf(CONTRIBUTING_MARKER_END, startIdx >= 0 ? startIdx : 0);
  if (startIdx === -1 || endIdx === -1) {
    return { body: existing, changed: false };
  }
  const before = existing.slice(0, startIdx).replace(/\n+$/, "");
  const after = existing.slice(endIdx + CONTRIBUTING_MARKER_END.length).replace(/^\n+/, "");
  let merged: string;
  if (before === "" && after === "") {
    merged = "";
  } else if (before === "") {
    merged = `${after}\n`;
  } else if (after === "") {
    merged = `${before}\n`;
  } else {
    merged = `${before}\n\n${after}\n`;
  }

  if (merged.trim() === "" || merged.trim() === "# Contributing") {
    return { body: null, changed: true };
  }

  return { body: merged, changed: true };
}

function wrap(body: string): string {
  const trimmed = body.replace(/^\n+/, "").replace(/\n+$/, "");
  return `${CONTRIBUTING_MARKER_START}\n${trimmed}\n${CONTRIBUTING_MARKER_END}`;
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

/** Read CONTRIBUTING.md, returning null when it does not exist. */
export function readContributing(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

/** Write CONTRIBUTING.md (creates parents). */
export function writeContributing(filePath: string, body: string): void {
  fs.writeFileSync(filePath, body, "utf-8");
}
