// ---------------------------------------------------------------------------
// `findChangedFiles` — return the workspace-relative file paths that have
// changed since a given git revision. Used by the `find_violations` MCP tool
// (wp-015) and reserved for a future `chemag analyze --since <rev>` flag.
//
// Implementation notes:
//   * Wraps `git diff --name-only <since>...HEAD` (committed changes between
//     the merge-base of <since> and HEAD) AND `git diff --name-only HEAD`
//     (uncommitted, unstaged changes) AND `git diff --name-only --cached`
//     (staged but uncommitted) so callers see both "what landed since X" and
//     "what's currently dirty in the working tree". Results are deduped.
//   * Returned paths are workspace-relative — git already prints them relative
//     to the repo root and we resolve `workspaceRoot` to that root.
//   * Returns `[]` for unknown revisions / non-git directories so the caller
//     can degrade gracefully instead of seeing a stack trace.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Return workspace-relative file paths that differ between the given
 * revision and the current working tree (committed + staged + unstaged).
 *
 * Errors are swallowed — non-git directories, unknown revisions, and missing
 * `git` binaries all return `[]` so the caller can fall back to "scan
 * everything" without surfacing a confusing low-level message.
 */
export async function findChangedFiles(since: string, workspaceRoot: string): Promise<string[]> {
  // Step 1: changes between <since> and HEAD (three-dot = merge-base diff).
  const committed = await runGit(["diff", "--name-only", `${since}...HEAD`], workspaceRoot);

  // Step 2: staged-but-uncommitted changes.
  const staged = await runGit(["diff", "--name-only", "--cached"], workspaceRoot);

  // Step 3: unstaged working-tree changes.
  const unstaged = await runGit(["diff", "--name-only"], workspaceRoot);

  // Dedupe + drop empty lines. Order is stable: committed first, then staged,
  // then unstaged — which matches the natural review order for an MCP client.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of [...committed, ...staged, ...unstaged]) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

async function runGit(args: string[], cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return stdout.split("\n");
  } catch {
    // git not installed, not a repo, or unknown revision — treat as no change.
    return [];
  }
}
