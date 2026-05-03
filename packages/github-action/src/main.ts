// ---------------------------------------------------------------------------
// Action entrypoint. Parses inputs, locates the chemag CLI (installing it
// globally if absent), runs the configured commands, writes a SARIF log to
// disk, posts a sticky PR comment, and sets the action outputs.
//
// SARIF upload is INTENTIONALLY not handled here — calling
// `actions/upload-sarif` from inside a JS action is unsupported. We expose
// the SARIF path via `core.setOutput('sarif-path', ...)` and document the
// follow-up step in action.yml's description.
// ---------------------------------------------------------------------------

import * as core from "@actions/core";
import * as github from "@actions/github";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { listPrChangedFiles, listPushChangedFiles } from "./changes";
import { postStickyComment, type CommentMode } from "./comment";
import { renderCommentBody, type RenderableDiagnostic } from "./format-comment";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export type FailOn = "error" | "warning" | "never";
export type ChemCommand = "check" | "analyze" | "both";
export type FormatName = "human" | "json" | "sarif" | "junit";

export interface Inputs {
  workspace: string;
  command: ChemCommand;
  failOn: FailOn;
  format: FormatName;
  commentMode: CommentMode;
  changedOnly: boolean;
  vocabulary: "standard" | "chemistry";
  /**
   * GitHub token. Empty string ⇒ no token configured; we fall back to
   * `process.env.GITHUB_TOKEN`. If both are empty, comment posting and
   * `pulls.listFiles` are skipped (and the user is warned once).
   */
  githubToken: string;
}

// ---------------------------------------------------------------------------
// Input parsing — exported so tests can drive it directly with a stub
// `core.getInput`-equivalent.
// ---------------------------------------------------------------------------

export type InputReader = (name: string) => string;

const FAIL_ON_VALUES: readonly FailOn[] = ["error", "warning", "never"];
const COMMAND_VALUES: readonly ChemCommand[] = ["check", "analyze", "both"];
const FORMAT_VALUES: readonly FormatName[] = ["human", "json", "sarif", "junit"];
const COMMENT_MODE_VALUES: readonly CommentMode[] = ["sticky", "append", "none"];
const VOCABULARY_VALUES: readonly Inputs["vocabulary"][] = ["standard", "chemistry"];

export function parseInputs(read: InputReader): Inputs {
  const workspace = (read("workspace") || "workspace.yaml").trim();

  const command = expectEnum(read("command") || "both", COMMAND_VALUES, "command");
  const failOn = expectEnum(read("fail-on") || "error", FAIL_ON_VALUES, "fail-on");
  const format = expectEnum(read("format") || "sarif", FORMAT_VALUES, "format");
  const commentMode = expectEnum(
    read("comment-mode") || "sticky",
    COMMENT_MODE_VALUES,
    "comment-mode",
  );
  const vocabulary = expectEnum(read("vocabulary") || "standard", VOCABULARY_VALUES, "vocabulary");

  const changedOnlyRaw = (read("changed-only") || "true").trim().toLowerCase();
  if (changedOnlyRaw !== "true" && changedOnlyRaw !== "false") {
    throw new Error(`Invalid "changed-only" value: ${changedOnlyRaw}. Expected "true" or "false".`);
  }
  const changedOnly = changedOnlyRaw === "true";

  // The action.yml default is the literal expression `${{ github.token }}`.
  // When the workflow author omits the input entirely, GitHub substitutes the
  // expression and we receive the actual token. But when the action is run
  // outside a workflow context (e.g. `act` in offline mode, the smoke test
  // below), we may receive the literal string. Detect that and fall back to
  // process.env.GITHUB_TOKEN.
  const tokenRaw = read("github-token") || "";
  const githubToken = looksLikeUnresolvedExpression(tokenRaw)
    ? (process.env.GITHUB_TOKEN ?? "")
    : tokenRaw;

  return {
    workspace,
    command,
    failOn,
    format,
    commentMode,
    changedOnly,
    vocabulary,
    githubToken,
  };
}

function expectEnum<T extends string>(value: string, allowed: readonly T[], inputName: string): T {
  const trimmed = value.trim();
  if (!(allowed as readonly string[]).includes(trimmed)) {
    throw new Error(
      `Invalid "${inputName}" value: ${value}. Expected one of: ${allowed.join(", ")}.`,
    );
  }
  return trimmed as T;
}

function looksLikeUnresolvedExpression(s: string): boolean {
  // Catch unresolved `${{ ... }}` or empty-after-substitution.
  return /^\s*\$\{\{[^}]*\}\}\s*$/.test(s) || s.trim() === "";
}

// ---------------------------------------------------------------------------
// SARIF inspection — we only need the result count and per-result level for
// the comment + threshold check. We never re-parse the full SARIF.
// ---------------------------------------------------------------------------

interface SarifResultLite {
  ruleId?: string;
  level?: "error" | "warning" | "note" | "none";
  message?: { text?: string };
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: { uri?: string };
      region?: { startLine?: number };
    };
  }>;
  properties?: { check?: string; compound?: string };
}

interface SarifLogLite {
  runs?: Array<{ results?: SarifResultLite[] }>;
}

export function diagnosticsFromSarif(sarifText: string): RenderableDiagnostic[] {
  const log = JSON.parse(sarifText) as SarifLogLite;
  const out: RenderableDiagnostic[] = [];
  for (const run of log.runs ?? []) {
    for (const r of run.results ?? []) {
      const level: "error" | "warning" = r.level === "warning" ? "warning" : "error";
      const loc = r.locations?.[0]?.physicalLocation;
      out.push({
        level,
        code: r.ruleId ?? "CHEM-UNKNOWN",
        message: r.message?.text ?? "",
        file: loc?.artifactLocation?.uri,
        line: loc?.region?.startLine,
        compound: r.properties?.compound,
      });
    }
  }
  return out;
}

/**
 * Merge two SARIF JSON strings into a single log (concatenating the `results`
 * arrays of each run). Used when the user picks `command: both` so we emit a
 * single SARIF file containing diagnostics from both check and analyze.
 */
export function mergeSarif(a: string, b: string): string {
  const la = JSON.parse(a) as { runs?: Array<{ results?: unknown[] }> };
  const lb = JSON.parse(b) as { runs?: Array<{ results?: unknown[] }> };
  if (!la.runs || la.runs.length === 0) return b;
  if (!lb.runs || lb.runs.length === 0) return a;
  // Both should have a single run with the same tool; just concat results.
  const merged = JSON.parse(JSON.stringify(la)) as {
    runs: Array<{ results?: unknown[] }>;
  };
  const incoming = lb.runs[0].results ?? [];
  merged.runs[0].results = [...(merged.runs[0].results ?? []), ...incoming];
  return `${JSON.stringify(merged, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// CLI location + invocation
// ---------------------------------------------------------------------------

/**
 * Locate the `chemag` binary on PATH. Returns the resolved path on success.
 * On failure, attempts a global install with `npm install -g @chemag/cli`
 * and returns the post-install path. Throws with a clear message if neither
 * step works.
 */
export async function locateChemagCli(): Promise<string> {
  const found = await whichChemag();
  if (found !== null) return found;

  core.info('chemag not found on PATH; running "npm install -g @chemag/cli@latest"');
  try {
    await execFileAsync("npm", ["install", "-g", "@chemag/cli@latest"], {
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    throw new Error(
      `Failed to install @chemag/cli globally: ${(e as Error).message}. Pre-install the chemag CLI in your workflow (e.g. \`npm install -g @chemag/cli\`) or pin a version with \`pnpm dlx\`.`,
    );
  }
  const postInstall = await whichChemag();
  if (postInstall === null) {
    throw new Error(
      "chemag was installed but is still not on PATH. Check the npm global bin directory is in your PATH.",
    );
  }
  return postInstall;
}

async function whichChemag(): Promise<string | null> {
  // Try `chemag` first, then the legacy alias `chem-ag`.
  for (const bin of ["chemag", "chem-ag"]) {
    try {
      const { stdout } = await execFileAsync(process.platform === "win32" ? "where" : "which", [
        bin,
      ]);
      const first = stdout.split("\n")[0]?.trim();
      if (first) return first;
    } catch {
      // not found, try next
    }
  }
  return null;
}

interface RunChemagOptions {
  cliPath: string;
  command: "check" | "analyze";
  workspaceFile: string;
  vocabulary: string;
  /** When provided and non-empty, passed as repeated `--changed <file>` flags. */
  changedFiles?: string[];
  cwd: string;
}

/**
 * Run `chemag <command> --format sarif <workspace>` and return the captured
 * stdout. Non-zero exit codes are EXPECTED (1 on violations) — we only
 * throw when the CLI fails to invoke or exits with code >= 2 (usage/IO
 * error).
 */
export async function runChemag(opts: RunChemagOptions): Promise<string> {
  const args: string[] = [opts.command, "--format", "sarif", opts.workspaceFile];
  // `--changed` is an analyze-only flag in the CLI today; check ignores it.
  if (opts.command === "analyze" && opts.changedFiles && opts.changedFiles.length > 0) {
    for (const f of opts.changedFiles) {
      args.push("--changed", f);
    }
  }

  return new Promise((resolve, reject) => {
    execFile(
      opts.cliPath,
      args,
      {
        cwd: opts.cwd,
        env: { ...process.env, CHEM_VOCABULARY: opts.vocabulary },
        maxBuffer: 256 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          // Exit code 1 = violations found, expected. >= 2 = real error.
          const code = (err as NodeJS.ErrnoException & { code?: number }).code;
          if (typeof code === "number" && code === 1) {
            resolve(stdout);
            return;
          }
          reject(
            new Error(
              `chemag ${opts.command} exited with code ${code ?? "?"}: ${stderr || err.message}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Threshold logic
// ---------------------------------------------------------------------------

export function meetsThreshold(diagnostics: RenderableDiagnostic[], failOn: FailOn): boolean {
  if (failOn === "never") return false;
  if (failOn === "warning") return diagnostics.length > 0;
  // "error"
  return diagnostics.some((d) => d.level === "error");
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function run(): Promise<void> {
  let inputs: Inputs;
  try {
    inputs = parseInputs((name) => core.getInput(name));
  } catch (e) {
    core.setFailed((e as Error).message);
    return;
  }

  const ctx = github.context;
  const isPullRequest = ctx.eventName === "pull_request" || ctx.eventName === "pull_request_target";
  const pullNumber = isPullRequest ? (ctx.payload.pull_request?.number ?? null) : null;
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  const workspaceFile = path.isAbsolute(inputs.workspace)
    ? inputs.workspace
    : path.join(cwd, inputs.workspace);

  // Sanity-check the workspace exists. Avoids a confusing CLI error and
  // makes the failure mode explicit per the action's acceptance criteria.
  try {
    await fs.access(workspaceFile);
  } catch {
    core.setFailed(`workspace file not found: ${workspaceFile}`);
    return;
  }

  // ---------- Locate CLI ----------
  let cliPath: string;
  try {
    cliPath = await locateChemagCli();
    core.info(`Using chemag at: ${cliPath}`);
  } catch (e) {
    core.setFailed((e as Error).message);
    return;
  }

  // ---------- Compute changed files (best-effort) ----------
  let changedFiles: string[] | null = null;
  if (inputs.changedOnly) {
    changedFiles = await computeChangedFiles(inputs, ctx, pullNumber);
    if (changedFiles !== null) {
      core.info(`Filtering analyze to ${changedFiles.length} changed file(s).`);
    } else {
      core.info("No diff available; running analyze on the full workspace.");
    }
  }

  // ---------- Run chemag ----------
  const commandsToRun: Array<"check" | "analyze"> =
    inputs.command === "both" ? ["check", "analyze"] : [inputs.command];

  let mergedSarif: string | null = null;
  for (const c of commandsToRun) {
    let sarifText: string;
    try {
      sarifText = await runChemag({
        cliPath,
        command: c,
        workspaceFile,
        vocabulary: inputs.vocabulary,
        changedFiles: changedFiles ?? undefined,
        cwd,
      });
    } catch (e) {
      core.setFailed((e as Error).message);
      return;
    }
    if (!sarifText.trim()) {
      // CLI may emit nothing if the command is a no-op for this workspace.
      // Synthesize an empty SARIF run so downstream parsing doesn't blow up.
      sarifText = `${JSON.stringify(emptySarif(), null, 2)}\n`;
    }
    mergedSarif = mergedSarif === null ? sarifText : mergeSarif(mergedSarif, sarifText);
  }
  if (mergedSarif === null) {
    mergedSarif = `${JSON.stringify(emptySarif(), null, 2)}\n`;
  }

  // ---------- Write SARIF to disk ----------
  const sarifPath = path.join(process.env.RUNNER_TEMP || os.tmpdir(), "chemag.sarif");
  try {
    await fs.writeFile(sarifPath, mergedSarif, "utf-8");
    core.info(`Wrote SARIF to ${sarifPath}`);
  } catch (e) {
    core.setFailed(`Failed to write SARIF: ${(e as Error).message}`);
    return;
  }

  // ---------- Parse diagnostics ----------
  let diagnostics: RenderableDiagnostic[] = [];
  try {
    diagnostics = diagnosticsFromSarif(mergedSarif);
  } catch (e) {
    core.warning(`Failed to parse SARIF for comment rendering: ${(e as Error).message}`);
  }

  // ---------- Post sticky comment ----------
  if (inputs.commentMode !== "none" && pullNumber !== null) {
    if (!inputs.githubToken) {
      core.warning(
        "comment-mode is not 'none' but no github-token is available; skipping PR comment.",
      );
    } else {
      try {
        const octokit = github.getOctokit(inputs.githubToken);
        const blobBase = ctx.payload.pull_request?.head?.sha
          ? `${ctx.payload.repository?.html_url}/blob/${ctx.payload.pull_request.head.sha}`
          : undefined;
        const body = renderCommentBody({
          workspace: inputs.workspace,
          command: inputs.command,
          diagnostics,
          blobBase,
          changedFileCount: changedFiles?.length,
        });
        const result = await postStickyComment(octokit.rest.issues, {
          owner: ctx.repo.owner,
          repo: ctx.repo.repo,
          pullNumber,
          body,
          mode: inputs.commentMode,
        });
        core.info(`Comment ${result.action}${result.commentId ? ` (id=${result.commentId})` : ""}`);
      } catch (e) {
        core.warning(`Failed to post PR comment: ${(e as Error).message}`);
      }
    }
  }

  // ---------- Set outputs + exit code ----------
  const failed = meetsThreshold(diagnostics, inputs.failOn);
  core.setOutput("sarif-path", sarifPath);
  core.setOutput("diagnostics-count", String(diagnostics.length));
  core.setOutput("failed", failed ? "true" : "false");

  const errorCount = diagnostics.filter((d) => d.level === "error").length;
  const warningCount = diagnostics.length - errorCount;
  core.info(
    `chemag finished — ${errorCount} error(s), ${warningCount} warning(s); fail-on=${inputs.failOn}; failed=${failed}`,
  );

  if (failed) {
    core.setFailed(
      `chemag fail-on threshold met (${errorCount} error(s), ${warningCount} warning(s)).`,
    );
  }
}

interface ContextLike {
  eventName: string;
  payload: {
    pull_request?: { number?: number; head?: { sha?: string } };
    before?: string;
    after?: string;
    repository?: { html_url?: string };
  };
  repo: { owner: string; repo: string };
}

async function computeChangedFiles(
  inputs: Inputs,
  ctx: ContextLike,
  pullNumber: number | null,
): Promise<string[] | null> {
  if (pullNumber !== null) {
    if (!inputs.githubToken) {
      core.warning("changed-only requested but no github-token; running on full workspace.");
      return null;
    }
    try {
      const octokit = github.getOctokit(inputs.githubToken);
      return await listPrChangedFiles(octokit.rest.pulls, {
        owner: ctx.repo.owner,
        repo: ctx.repo.repo,
        pullNumber,
      });
    } catch (e) {
      core.warning(`Failed to list PR files: ${(e as Error).message}`);
      return null;
    }
  }
  if (ctx.eventName === "push") {
    const before = typeof ctx.payload.before === "string" ? ctx.payload.before : "";
    const after = typeof ctx.payload.after === "string" ? ctx.payload.after : "";
    return await listPushChangedFiles({ before, after });
  }
  return null;
}

function emptySarif(): unknown {
  return {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "chemag",
            version: "0.0.0",
            informationUri: "https://github.com/chemag-org/chemag",
            rules: [],
          },
        },
        results: [],
      },
    ],
  };
}

// ncc bundles this file as the GHA entrypoint. Invoke run() at module scope.
// We guard with a `require.main === module` check so unit tests can import
// helper functions without triggering the full action.
/* c8 ignore start */
if (require.main === module) {
  run().catch((err) => {
    core.setFailed(`Unhandled error: ${(err as Error).stack ?? String(err)}`);
  });
}
/* c8 ignore stop */
