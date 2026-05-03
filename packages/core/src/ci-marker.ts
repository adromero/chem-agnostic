// ---------------------------------------------------------------------------
// Sticky-comment marker shared by the chemag CI integrations (GitHub Action,
// GitLab MR poster — wp-024 — and Bitbucket — wp-025). The marker is a hidden
// HTML comment placed on the FIRST line of the comment body so detection is
// O(1) and we don't accidentally match user comments that quote the string
// elsewhere.
//
// Each integration's "post-or-update" loop calls `hasMarker(body)` to decide
// whether an existing comment is one of ours, and `wrapWithMarker(body)` to
// prepend the marker exactly once before sending.
//
// The marker string MUST stay byte-for-byte stable across releases — every
// chemag-managed comment ever written has it on line one, and rotating the
// marker would orphan all of them and start posting duplicates.
// ---------------------------------------------------------------------------

/**
 * Hidden HTML-comment sentinel placed on line one of every chemag-managed
 * sticky comment.
 */
export const STICKY_MARKER = "<!-- chemag:comment -->";

/**
 * Whether `body`'s first line is the chemag sticky marker. Tolerant of a
 * leading BOM (U+FEFF) or whitespace before the marker, since web editors
 * occasionally insert one when round-tripping comments.
 */
export function hasMarker(body: string): boolean {
  const stripped = body.replace(/^﻿/, "").trimStart();
  return stripped.startsWith(STICKY_MARKER);
}

/**
 * Prepend `STICKY_MARKER\n` to `body` unless the body already starts with the
 * marker (in which case it's returned untouched). Idempotent — calling this
 * twice on the same string yields the same result, so callers don't need to
 * track whether a body has been wrapped already.
 */
export function wrapWithMarker(body: string): string {
  if (hasMarker(body)) return body;
  return `${STICKY_MARKER}\n${body}`;
}
