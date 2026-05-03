/** Subset of the Octokit pulls API we touch. Tests stub this directly. */
export interface PullsApi {
    listFiles: (params: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page?: number;
        page?: number;
    }) => Promise<{
        data: Array<{
            filename: string;
            status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged";
        }>;
    }>;
}
export interface ListPrChangedFilesOptions {
    owner: string;
    repo: string;
    pullNumber: number;
    /**
     * Cap on the number of pages fetched (per_page=100). Defaults to 30 ⇒
     * 3000 files, which matches GitHub's documented hard cap for `listFiles`.
     * Bumped for tests that mock arbitrarily large responses.
     */
    maxPages?: number;
}
/**
 * Paginate through `pulls.listFiles` and return the filenames of all
 * non-removed files in the PR. Always returns POSIX-style relative paths.
 */
export declare function listPrChangedFiles(pulls: PullsApi, opts: ListPrChangedFilesOptions): Promise<string[]>;
export interface ListPushChangedFilesOptions {
    before: string;
    after: string;
    /** Working directory for the git command. Defaults to process.cwd(). */
    cwd?: string;
}
/**
 * Run `git diff --name-only <before>..<after>` and return the list of
 * changed files. Treats the all-zero SHA (push to a brand-new branch) as
 * "no diff available" and returns null so the caller falls back to a full
 * scan.
 */
export declare function listPushChangedFiles(opts: ListPushChangedFilesOptions): Promise<string[] | null>;
