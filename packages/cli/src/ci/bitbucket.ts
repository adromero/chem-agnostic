// ---------------------------------------------------------------------------
// `chemag ci bitbucket` — post (or update in place) a sticky chemag comment
// on a Bitbucket Cloud pull request.
//
// Surface:
//   chemag check --format json | chemag ci bitbucket
//   chemag check --format json > diags.json && chemag ci bitbucket --input diags.json
//
// The command consumes a chemag --format json envelope (the canonical format
// emitted by `chemag check` / `chemag analyze`), derives a Markdown body, and
// either updates the existing chemag-managed PR comment in place or creates a
// new one. The sticky-comment marker (`<!-- chemag:comment -->`) lives in
// `@chemag/core/ci-marker` and is byte-stable across releases — the same
// sentinel the GitHub Action and the GitLab MR poster use. Rotating the
// marker would orphan every chemag comment ever written and start posting
// duplicates.
//
// Required environment:
//   - BITBUCKET_TOKEN          — repo/PR-write OAuth or app-password token.
//                                 Sent as `Authorization: Bearer <token>`.
//   - BITBUCKET_REPO_FULL_NAME — `<workspace>/<repo>` slug (Bitbucket
//                                 Pipelines exposes this as
//                                 `BITBUCKET_REPO_FULL_NAME`).
//   - BITBUCKET_PR_ID          — numeric PR id (Bitbucket Pipelines exposes
//                                 this as `BITBUCKET_PR_ID` on PR pipelines).
//
// Bitbucket REST notes — these intentionally diverge from GitLab's surface
// and the differences are load-bearing for tests:
//   - Body shape is `{ "content": { "raw": "<markdown>" } }` (NOT `{ body }`).
//   - Auth header is `Authorization: Bearer <token>` (NOT `PRIVATE-TOKEN`).
//   - Pagination uses CURSORS — the response carries `next` as an absolute
//     URL; iterate by following it. Do NOT use `?page=` / `?pagelen=`.
//
// Exit codes:
//   0 — comment posted/updated successfully.
//   2 — missing env vars, malformed JSON envelope, or REST failure.
//
// We intentionally don't fail the build on diagnostic count — the operator
// already saw the chemag exit code from the prior step. `ci bitbucket` is a
// reporter, not a gate.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { STICKY_MARKER, hasMarker, wrapWithMarker } from "@chemag/core/ci-marker";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const BLD = "\x1b[1m";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Subset of a Bitbucket Cloud PR comment returned by
 * `GET /repositories/:workspace/:repo/pullrequests/:id/comments`.
 *
 * We only model the fields the sticky-comment poster touches. Bitbucket
 * comments do NOT have a `system` flag like GitLab; instead, generated /
 * inline review comments carry an `inline` object, and reply comments carry
 * a `parent.id`. The chemag filter must skip both.
 */
export interface BitbucketComment {
  id: number;
  content?: { raw?: string };
  /** Present on inline (file/line) review comments — skip these. */
  inline?: unknown;
  /** Present on reply comments — skip these (we only sticky on top-level). */
  parent?: { id: number };
}

/**
 * Subset of the Bitbucket REST surface the comment poster touches. Tests
 * provide a hand-rolled fake; production wires in `makeBitbucketApi` below.
 *
 * `listComments` is an async generator so the (production) cursor walker and
 * the (test) in-memory fake can both stream comments without forcing the
 * caller to think about pagination.
 */
export interface BitbucketApi {
  listComments(): AsyncGenerator<BitbucketComment>;
  createComment(body: string): Promise<BitbucketComment>;
  updateComment(id: number, body: string): Promise<BitbucketComment>;
}

/** Normalized Bitbucket Cloud env for one PR pipeline run. */
export interface BitbucketEnv {
  token: string;
  /** `<workspace>/<repo>` — used directly in the REST path. */
  repoFullName: string;
  prId: string;
}

/**
 * Minimal shape of a chemag --format json diagnostic. We deliberately
 * tolerate extra fields so future schema additions don't break the reporter.
 */
export interface InputDiagnostic {
  level: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  line?: number;
  compound?: string;
  hint?: string;
}

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

/**
 * Read + validate the Bitbucket Pipelines env vars. Returns `{ token,
 * repoFullName, prId }` or throws an Error naming the missing variable.
 *
 * Empty strings are treated as missing — Bitbucket Pipelines expands unset
 * masked variables to the empty string rather than leaving them unset, and
 * silently posting with `Authorization: Bearer ` would yield a confusing 401
 * far away from the configuration mistake.
 */
export function validateBitbucketEnv(env: NodeJS.ProcessEnv = process.env): BitbucketEnv {
  const token = env.BITBUCKET_TOKEN ?? "";
  const repoFullName = env.BITBUCKET_REPO_FULL_NAME ?? "";
  const prId = env.BITBUCKET_PR_ID ?? "";

  const missing: string[] = [];
  if (!token) missing.push("BITBUCKET_TOKEN");
  if (!repoFullName) missing.push("BITBUCKET_REPO_FULL_NAME");
  if (!prId) missing.push("BITBUCKET_PR_ID");

  if (missing.length > 0) {
    throw new Error(
      `chemag ci bitbucket: missing required environment variable(s): ${missing.join(
        ", ",
      )}. Set them in your bitbucket-pipelines.yml step (BITBUCKET_REPO_FULL_NAME and BITBUCKET_PR_ID are provided automatically on pull-request pipelines; BITBUCKET_TOKEN must be set explicitly, e.g. via a secured repository variable).`,
    );
  }

  return { token, repoFullName, prId };
}

// ---------------------------------------------------------------------------
// Post-or-update loop (the core idempotency primitive)
// ---------------------------------------------------------------------------

/**
 * Defensive cap on cursor-following pagination. Bitbucket's `next` URL is
 * supposed to terminate naturally, but a malformed/looping response would
 * spin forever; we'd rather throw with a clear error than hang the pipeline.
 *
 * 200 pages * 50 comments-per-page (Bitbucket's default) is 10,000 comments —
 * pathological for any real PR.
 */
const MAX_PAGES = 200;

/**
 * Post a new chemag comment, or update an existing chemag-managed comment in
 * place. Idempotency is keyed on `STICKY_MARKER` (a hidden HTML comment on
 * line one — see `@chemag/core/ci-marker`).
 *
 * `body` should be the human-readable Markdown body — the marker is prepended
 * here exactly once via `wrapWithMarker`, so callers don't need to think
 * about double-marking.
 *
 * Returns the comment id and the action taken.
 */
export async function postOrUpdateComment(
  api: BitbucketApi,
  body: string,
): Promise<{ commentId: number; action: "created" | "updated" }> {
  const fullBody = wrapWithMarker(body);

  const existing = await findChemagComment(api);
  if (existing !== null) {
    const updated = await api.updateComment(existing.id, fullBody);
    return { commentId: updated.id, action: "updated" };
  }
  const created = await api.createComment(fullBody);
  return { commentId: created.id, action: "created" };
}

/**
 * Walk the PR's comments looking for the first top-level chemag comment.
 *
 * The filter intentionally rejects two categories that have no GitLab
 * parallel and would otherwise produce a non-functional sticky:
 *   1. `inline !== undefined` — file/line review threads. We never sticky on
 *      these (chemag posts a single top-level summary), so we must not
 *      accidentally update one even if its body happens to contain the
 *      marker.
 *   2. `parent !== undefined` — reply comments. Updating a reply orphans
 *      the top-level chemag comment from the next run's perspective.
 *
 * Bitbucket comments do NOT carry a `system` flag, so the GitLab-style
 * `system === true` skip would be a no-op here — that's why the filter
 * shape is different.
 */
export async function findChemagComment(api: BitbucketApi): Promise<BitbucketComment | null> {
  for await (const c of api.listComments()) {
    if (c.inline !== undefined) continue;
    if (c.parent !== undefined) continue;
    const raw = c.content?.raw;
    if (typeof raw === "string" && hasMarker(raw)) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// REST plumbing — uses globalThis.fetch (Node 18+ has native fetch).
// Exported for tests so they can stub the API surface without monkey-patching
// the global fetch.
// ---------------------------------------------------------------------------

/**
 * Build a real `BitbucketApi` bound to a specific repo + PR + token. This is
 * the production wiring; tests should construct their own BitbucketApi shape
 * and pass it directly to `postOrUpdateComment`.
 *
 * Three load-bearing details, each different from the GitLab equivalent:
 *   1. Body shape: `{ content: { raw } }` (Bitbucket) — empty `content.raw`
 *      posts an empty comment, NOT a 4xx, so getting this wrong silently
 *      breaks the reporter.
 *   2. Auth header: `Authorization: Bearer <token>` — wrong header returns
 *      401 with no actionable hint in the body.
 *   3. Pagination: response carries `next` as an absolute URL; we follow it
 *      until it's undefined. The first request is to `baseUrl`, subsequent
 *      requests are to whatever URL Bitbucket hands us — so we DO NOT
 *      string-concat `?page=` here.
 */
export function makeBitbucketApi(env: BitbucketEnv): BitbucketApi {
  const baseUrl =
    `https://api.bitbucket.org/2.0/repositories/${env.repoFullName}` +
    `/pullrequests/${encodeURIComponent(env.prId)}/comments`;

  const headers = {
    Authorization: `Bearer ${env.token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  return {
    async *listComments() {
      let url: string | undefined = baseUrl;
      for (let page = 0; page < MAX_PAGES; page++) {
        if (url === undefined) return;
        const res = await fetch(url, { method: "GET", headers });
        if (!res.ok) {
          throw new Error(`Bitbucket GET comments failed: HTTP ${res.status} ${res.statusText}`);
        }
        const data = (await res.json()) as { values?: BitbucketComment[]; next?: string };
        for (const c of data.values ?? []) yield c;
        url = data.next;
        if (url === undefined) return;
      }
      throw new Error(
        `Bitbucket GET comments: pagination exceeded MAX_PAGES=${MAX_PAGES} — refusing to follow further 'next' cursors.`,
      );
    },
    async createComment(body) {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: { raw: body } }),
      });
      if (!res.ok) {
        throw new Error(`Bitbucket POST comment failed: HTTP ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as BitbucketComment;
    },
    async updateComment(id, body) {
      const res = await fetch(`${baseUrl}/${id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ content: { raw: body } }),
      });
      if (!res.ok) {
        throw new Error(`Bitbucket PUT comment failed: HTTP ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as BitbucketComment;
    },
  };
}

// ---------------------------------------------------------------------------
// Markdown body
// ---------------------------------------------------------------------------

/**
 * Render a Markdown body summarising the diagnostics. Mirrors the GitLab
 * poster's renderer (heading + summary line + table) so the two integrations
 * surface a familiar shape to operators flipping between providers. Pure: no
 * I/O.
 */
export function formatBody(diagnostics: InputDiagnostic[], workspaceName?: string): string {
  const errors = diagnostics.filter((d) => d.level === "error").length;
  const warnings = diagnostics.filter((d) => d.level === "warning").length;
  const ws = workspaceName ?? "workspace";

  const lines: string[] = [];
  lines.push(`### chemag — \`${ws}\``);
  lines.push("");

  if (diagnostics.length === 0) {
    lines.push("No architectural violations detected. ");
    return lines.join("\n");
  }

  lines.push(`**${errors}** error(s), **${warnings}** warning(s).`);
  lines.push("");
  lines.push("| Level | Code | File | Message |");
  lines.push("| --- | --- | --- | --- |");
  for (const d of diagnostics) {
    const file = d.file ? (d.line ? `${d.file}:${d.line}` : d.file) : "—";
    lines.push(`| ${d.level} | \`${d.code}\` | ${escapeCell(file)} | ${escapeCell(d.message)} |`);
  }
  return lines.join("\n");
}

function escapeCell(s: string): string {
  // Markdown table cells: escape pipes + collapse newlines so the row stays
  // on a single line.
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// ---------------------------------------------------------------------------
// argv + stdin parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  inputFile: string | null;
  workspaceName: string | null;
  help: boolean;
}

export function parseBitbucketArgs(argv: string[]): ParsedArgs {
  let inputFile: string | null = null;
  let workspaceName: string | null = null;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }
    if (a === "--input") {
      const v = argv[i + 1];
      if (v && !v.startsWith("-")) {
        inputFile = v;
        i++;
      }
      continue;
    }
    if (a.startsWith("--input=")) {
      inputFile = a.slice("--input=".length);
      continue;
    }
    if (a === "--workspace") {
      const v = argv[i + 1];
      if (v && !v.startsWith("-")) {
        workspaceName = v;
        i++;
      }
      continue;
    }
    if (a.startsWith("--workspace=")) {
      workspaceName = a.slice("--workspace=".length);
    }
  }
  return { inputFile, workspaceName, help };
}

function printHelp(): void {
  console.log(`\n${BLD}chemag ci bitbucket [--input <file>] [--workspace <name>]${R}\n`);
  console.log("Post a sticky chemag comment on the current Bitbucket PR.\n");
  console.log(`${BLD}Options:${R}`);
  console.log("  --input <file>      Read chemag --format json from <file>");
  console.log("                      (default: read from stdin).");
  console.log("  --workspace <name>  Workspace name to render in the comment heading");
  console.log("                      (default: extracted from JSON envelope).\n");
  console.log(`${BLD}Required environment:${R}`);
  console.log("  BITBUCKET_TOKEN, BITBUCKET_REPO_FULL_NAME, BITBUCKET_PR_ID.\n");
}

/**
 * Entry point — invoked by the dispatcher in `./index.ts`. Reads + validates
 * env, parses args, decodes the chemag JSON envelope from --input or stdin,
 * formats a Markdown body, and posts/updates the PR comment.
 */
export async function cmdCiBitbucket(argv: string[]): Promise<void> {
  const args = parseBitbucketArgs(argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let env: BitbucketEnv;
  try {
    env = validateBitbucketEnv();
  } catch (e: unknown) {
    console.error(`${RED}error${R} ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
    return;
  }

  let raw: string;
  try {
    raw = args.inputFile !== null ? readFileSync(args.inputFile, "utf-8") : await readStdin();
  } catch (e: unknown) {
    console.error(
      `${RED}error${R} chemag ci bitbucket: failed to read input — ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(2);
    return;
  }

  let envelope: { workspace?: string; diagnostics?: InputDiagnostic[] };
  try {
    envelope = JSON.parse(raw) as { workspace?: string; diagnostics?: InputDiagnostic[] };
  } catch (e: unknown) {
    console.error(
      `${RED}error${R} chemag ci bitbucket: input is not valid JSON — ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(2);
    return;
  }

  const diagnostics = envelope.diagnostics ?? [];
  const workspaceName = args.workspaceName ?? envelope.workspace ?? undefined;

  const body = formatBody(diagnostics, workspaceName);
  const api = makeBitbucketApi(env);

  try {
    const r = await postOrUpdateComment(api, body);
    console.log(
      `chemag ci bitbucket: ${r.action} comment ${r.commentId} on PR #${env.prId} (${diagnostics.length} diagnostic(s)).`,
    );
    process.exit(0);
  } catch (e: unknown) {
    console.error(
      `${RED}error${R} chemag ci bitbucket: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(2);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// Re-export the marker constants for any out-of-tree consumer that wants the
// same sticky-comment guarantees the official poster gives them.
export { STICKY_MARKER, hasMarker, wrapWithMarker };
