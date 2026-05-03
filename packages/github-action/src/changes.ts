// ---------------------------------------------------------------------------
// Detect which files changed for the current event.
//
//   pull_request → octokit.pulls.listFiles (paginated; up to 3000 files for a
//                  single PR per GitHub's documented hard cap).
//   push          → `git diff --name-only <before>..<after>` against the
//                   GITHUB_EVENT payload's `before` / `after` SHAs.
//   anything else → returns null, signalling "no filter, scan everything".
//
// Returns POSIX-style relative paths (the same shape ts-morph and the
// chemag CLI consume). Removed files are filtered out so callers don't try
// to read them.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
export async function listPrChangedFiles(
  pulls: PullsApi,
  opts: ListPrChangedFilesOptions,
): Promise<string[]> {
  const PER_PAGE = 100;
  const maxPages = opts.maxPages ?? 30;
  const out: string[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const res = await pulls.listFiles({
      owner: opts.owner,
      repo: opts.repo,
      pull_number: opts.pullNumber,
      per_page: PER_PAGE,
      page,
    });
    for (const f of res.data) {
      if (f.status === "removed") continue;
      out.push(f.filename);
    }
    if (res.data.length < PER_PAGE) break;
  }
  return out;
}

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
export async function listPushChangedFiles(
  opts: ListPushChangedFilesOptions,
): Promise<string[] | null> {
  const ZERO_SHA = "0000000000000000000000000000000000000000";
  if (!opts.before || opts.before === ZERO_SHA) return null;
  if (!opts.after || opts.after === ZERO_SHA) return null;

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-only", `${opts.before}..${opts.after}`],
      { cwd: opts.cwd ?? process.cwd(), maxBuffer: 32 * 1024 * 1024 },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return null;
  }
}
