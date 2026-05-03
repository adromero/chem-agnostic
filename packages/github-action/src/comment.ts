// ---------------------------------------------------------------------------
// Sticky PR comment manager. Mirrors the merge-marker idempotency pattern
// from `@chemag/core/rules-emitters/markers` but adapted for GitHub PR
// comments: the marker is a hidden HTML comment on the FIRST line of the
// body, and we identify a chemag comment by `body.startsWith(STICKY_MARKER)`.
//
// The marker constant + its `hasMarker` / `wrapWithMarker` helpers live in
// `@chemag/core/ci-marker` so every CI integration (GitHub Action, GitLab MR
// poster, Bitbucket — wp-024+) shares the exact same byte-stable sentinel.
// We import them via the BARREL `@chemag/core` here because this package's
// tsconfig uses `"moduleResolution": "node"` (legacy, to match ncc's CJS
// output) — the legacy resolver does not read package `exports` maps, so the
// `@chemag/core/ci-marker` subpath would fail typecheck. The forwarding
// re-export at the bottom keeps the existing `./src/comment` import path
// intact for tests and any downstream consumer that imported the marker
// directly from this module.
//
// Behavior:
//   - "sticky" (default): list PR comments, find the first one starting with
//     STICKY_MARKER (authored by anyone — usually the github-actions bot but
//     could also be the workflow's own token), update it in place. If none
//     exists, create one.
//   - "append": always create a new comment. Useful for audit trails.
//   - "none": skip the API call entirely.
//
// We keep the dependency surface minimal — the manager accepts an
// `OctokitLike` shape so tests can stub the relevant endpoints without
// pulling in the real Octokit class.
// ---------------------------------------------------------------------------

// NOTE: importing from the BARREL (not the `@chemag/core/ci-marker` subpath) —
// see the file header for the moduleResolution=node rationale. The forwarding
// `export ... from "@chemag/core"` at the bottom keeps the existing
// `import { STICKY_MARKER, hasMarker } from "./comment"` test imports valid.
import { STICKY_MARKER, hasMarker, wrapWithMarker } from "@chemag/core";

export type CommentMode = "sticky" | "append" | "none";

export interface PostCommentOptions {
  owner: string;
  repo: string;
  /** Pull request number, or null for non-PR events (push, schedule, ...). */
  pullNumber: number | null;
  body: string;
  mode: CommentMode;
}

export interface PostCommentResult {
  /** "created" | "updated" | "skipped". */
  action: "created" | "updated" | "skipped";
  commentId?: number;
  /** Reason the comment was skipped (when action === "skipped"). */
  skipReason?: string;
}

/**
 * Subset of the Octokit issues API the comment manager touches. Tests
 * supply a hand-rolled fake; production code wires in
 * `octokit.rest.issues`.
 */
export interface IssuesApi {
  listComments: (params: {
    owner: string;
    repo: string;
    issue_number: number;
    per_page?: number;
    page?: number;
  }) => Promise<{ data: Array<{ id: number; body?: string | null }> }>;
  createComment: (params: {
    owner: string;
    repo: string;
    issue_number: number;
    body: string;
  }) => Promise<{ data: { id: number } }>;
  updateComment: (params: {
    owner: string;
    repo: string;
    comment_id: number;
    body: string;
  }) => Promise<{ data: { id: number } }>;
}

/**
 * Post (or update) a sticky comment on the given PR.
 *
 * Always prepends `STICKY_MARKER` to the body before sending to GitHub —
 * callers should pass the human-readable body, not a pre-marked string.
 * This makes test setup simpler and prevents double-marking.
 */
export async function postStickyComment(
  issues: IssuesApi,
  opts: PostCommentOptions,
): Promise<PostCommentResult> {
  if (opts.mode === "none") {
    return { action: "skipped", skipReason: 'comment-mode is "none"' };
  }
  if (opts.pullNumber === null) {
    return { action: "skipped", skipReason: "not a pull_request event" };
  }

  const fullBody = wrapWithMarker(opts.body);

  if (opts.mode === "append") {
    const created = await issues.createComment({
      owner: opts.owner,
      repo: opts.repo,
      issue_number: opts.pullNumber,
      body: fullBody,
    });
    return { action: "created", commentId: created.data.id };
  }

  // mode === "sticky"
  const existing = await findStickyComment(issues, opts.owner, opts.repo, opts.pullNumber);
  if (existing !== null) {
    const updated = await issues.updateComment({
      owner: opts.owner,
      repo: opts.repo,
      comment_id: existing,
      body: fullBody,
    });
    return { action: "updated", commentId: updated.data.id };
  }
  const created = await issues.createComment({
    owner: opts.owner,
    repo: opts.repo,
    issue_number: opts.pullNumber,
    body: fullBody,
  });
  return { action: "created", commentId: created.data.id };
}

/**
 * Walk the PR's comment list one page at a time looking for the first
 * comment whose body begins with `STICKY_MARKER`. Returns the comment id,
 * or null if none exists.
 */
export async function findStickyComment(
  issues: IssuesApi,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<number | null> {
  const PER_PAGE = 100;
  // Cap pages defensively — a PR with >5000 comments is pathological and
  // we'd rather create a duplicate than spin forever.
  const MAX_PAGES = 50;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await issues.listComments({
      owner,
      repo,
      issue_number: pullNumber,
      per_page: PER_PAGE,
      page,
    });
    for (const c of res.data) {
      const body = c.body ?? "";
      if (hasMarker(body)) return c.id;
    }
    if (res.data.length < PER_PAGE) return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Forwarding re-export — keeps `import { STICKY_MARKER, hasMarker } from
// "./comment"` working for the existing test suite (and any out-of-tree
// consumer that imported the marker directly from this module pre-wp-024).
// The canonical definitions live in `@chemag/core/ci-marker`.
// ---------------------------------------------------------------------------
export { STICKY_MARKER, hasMarker, wrapWithMarker } from "@chemag/core";
