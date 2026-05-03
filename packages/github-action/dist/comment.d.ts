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
    }) => Promise<{
        data: Array<{
            id: number;
            body?: string | null;
        }>;
    }>;
    createComment: (params: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
    }) => Promise<{
        data: {
            id: number;
        };
    }>;
    updateComment: (params: {
        owner: string;
        repo: string;
        comment_id: number;
        body: string;
    }) => Promise<{
        data: {
            id: number;
        };
    }>;
}
/**
 * Post (or update) a sticky comment on the given PR.
 *
 * Always prepends `STICKY_MARKER` to the body before sending to GitHub —
 * callers should pass the human-readable body, not a pre-marked string.
 * This makes test setup simpler and prevents double-marking.
 */
export declare function postStickyComment(issues: IssuesApi, opts: PostCommentOptions): Promise<PostCommentResult>;
/**
 * Walk the PR's comment list one page at a time looking for the first
 * comment whose body begins with `STICKY_MARKER`. Returns the comment id,
 * or null if none exists.
 */
export declare function findStickyComment(issues: IssuesApi, owner: string, repo: string, pullNumber: number): Promise<number | null>;
export { STICKY_MARKER, hasMarker, wrapWithMarker } from "@chemag/core";
