// ---------------------------------------------------------------------------
// `chemag ci gitlab` — post (or update in place) a sticky chemag comment on a
// GitLab merge request.
//
// Surface:
//   chemag check --format json | chemag ci gitlab
//   chemag check --format json > diags.json && chemag ci gitlab --input diags.json
//
// The command consumes a chemag --format json envelope (the canonical format
// emitted by `chemag check` / `chemag analyze`), derives a Markdown body, and
// either updates the existing chemag-managed MR note in place or creates a
// new one. The sticky-comment marker (`<!-- chemag:comment -->`) lives in
// `@chemag/core/ci-marker` and is byte-stable across releases — the same
// sentinel the GitHub Action and (eventually, wp-025) the Bitbucket poster
// use. Rotating the marker would orphan every chemag note ever written and
// start posting duplicates.
//
// Required environment:
//   - GITLAB_TOKEN            — personal access token / job token. Needs
//                               `api` scope; for `CI_JOB_TOKEN` the project
//                               must allow "Limit access to this project".
//   - CI_PROJECT_ID           — numeric project id (GitLab CI sets this).
//   - CI_MERGE_REQUEST_IID    — MR iid in the project (GitLab CI sets this on
//                               merge_request_event pipelines).
//
// Optional:
//   - CI_API_V4_URL           — full URL prefix to /api/v4 (default:
//                               https://gitlab.com/api/v4). Self-hosted
//                               instances must set this.
//
// Exit codes:
//   0 — comment posted/updated successfully (chemag may still surface
//       findings, but POSTING the report itself succeeded).
//   2 — missing env vars, malformed JSON envelope, or REST failure.
//
// We intentionally don't fail the build on diagnostic count — the operator
// already saw the chemag exit code from the prior step. `ci gitlab` is a
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

/** Subset of a GitLab MR note returned by `GET /merge_requests/:iid/notes`. */
export interface GitLabNote {
  id: number;
  body: string;
  /** True when the note is system-generated (e.g. "added 1 commit"). */
  system?: boolean;
}

/**
 * Subset of the GitLab REST surface the comment poster touches. Tests provide
 * a hand-rolled fake; production wires in `restCall` below.
 */
export interface GitLabApi {
  listMrNotes: (params: { page?: number; perPage?: number }) => Promise<GitLabNote[]>;
  createMrNote: (params: { body: string }) => Promise<GitLabNote>;
  updateMrNote: (params: { noteId: number; body: string }) => Promise<GitLabNote>;
}

/** Normalized GitLab CI environment for one MR pipeline run. */
export interface GitLabEnv {
  token: string;
  projectId: string;
  mrIid: string;
  /** Base URL for the v4 API, no trailing slash. */
  apiBase: string;
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
 * Read + validate the GitLab CI env vars. Returns `{ token, projectId, mrIid,
 * apiBase }` or throws an Error with a clear, actionable message naming the
 * missing variable. We deliberately don't fall back to defaults for the
 * required fields — silent fallbacks (e.g. "" → public access) would post
 * to the wrong project or fail with a confusing 401.
 */
export function validateGitLabEnv(env: NodeJS.ProcessEnv = process.env): GitLabEnv {
  const token = env.GITLAB_TOKEN ?? "";
  const projectId = env.CI_PROJECT_ID ?? "";
  const mrIid = env.CI_MERGE_REQUEST_IID ?? "";

  const missing: string[] = [];
  if (!token) missing.push("GITLAB_TOKEN");
  if (!projectId) missing.push("CI_PROJECT_ID");
  if (!mrIid) missing.push("CI_MERGE_REQUEST_IID");

  if (missing.length > 0) {
    throw new Error(
      `chemag ci gitlab: missing required environment variable(s): ${missing.join(", ")}. Set them in your .gitlab-ci.yml job (CI_PROJECT_ID and CI_MERGE_REQUEST_IID are provided automatically on merge_request_event pipelines; GITLAB_TOKEN must be set explicitly, e.g. via a masked CI/CD variable).`,
    );
  }

  // Trim trailing slash so callers can string-concat path segments cleanly.
  const apiBase = (env.CI_API_V4_URL ?? "https://gitlab.com/api/v4").replace(/\/+$/, "");

  return { token, projectId, mrIid, apiBase };
}

// ---------------------------------------------------------------------------
// Post-or-update loop (the core idempotency primitive)
// ---------------------------------------------------------------------------

/**
 * Post a new chemag comment, or update an existing chemag-managed comment in
 * place. Idempotency is keyed on `STICKY_MARKER` (a hidden HTML comment on
 * line one — see `@chemag/core/ci-marker`).
 *
 * `body` should be the human-readable Markdown body — the marker is prepended
 * here exactly once via `wrapWithMarker`, so callers don't need to think about
 * double-marking.
 *
 * Returns the note id and the action taken.
 */
export async function postOrUpdateMrComment(
  api: GitLabApi,
  body: string,
): Promise<{ noteId: number; action: "created" | "updated" }> {
  const fullBody = wrapWithMarker(body);

  const existing = await findChemagNote(api);
  if (existing !== null) {
    const updated = await api.updateMrNote({ noteId: existing.id, body: fullBody });
    return { noteId: updated.id, action: "updated" };
  }
  const created = await api.createMrNote({ body: fullBody });
  return { noteId: created.id, action: "created" };
}

/**
 * Walk the MR's notes one page at a time looking for the first non-system
 * note that begins with the chemag sticky marker. Returns the note or null.
 *
 * GitLab's `notes` endpoint paginates with `page=` / `per_page=` (max 100).
 * We cap pages defensively — an MR with thousands of notes is pathological
 * and we'd rather post a duplicate than spin forever.
 */
async function findChemagNote(api: GitLabApi): Promise<GitLabNote | null> {
  const PER_PAGE = 100;
  const MAX_PAGES = 50;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const notes = await api.listMrNotes({ page, perPage: PER_PAGE });
    for (const n of notes) {
      if (n.system === true) continue;
      if (hasMarker(n.body)) return n;
    }
    if (notes.length < PER_PAGE) return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// REST plumbing — uses globalThis.fetch (Node 18+ has native fetch).
// Exported for tests so they can stub the API surface without monkey-patching
// the global fetch.
// ---------------------------------------------------------------------------

/**
 * Build a real `GitLabApi` bound to a specific project + MR + token. This is
 * the production wiring; tests should construct their own GitLabApi shape and
 * pass it directly to `postOrUpdateMrComment`.
 */
export function makeGitLabApi(env: GitLabEnv): GitLabApi {
  const notesUrl =
    `${env.apiBase}/projects/${encodeURIComponent(env.projectId)}` +
    `/merge_requests/${encodeURIComponent(env.mrIid)}/notes`;

  const headers = {
    "PRIVATE-TOKEN": env.token,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  return {
    async listMrNotes({ page = 1, perPage = 100 }) {
      const url = `${notesUrl}?page=${page}&per_page=${perPage}`;
      const res = await fetch(url, { method: "GET", headers });
      if (!res.ok) {
        throw new Error(`GitLab GET notes failed: HTTP ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as GitLabNote[];
      return data;
    },
    async createMrNote({ body }) {
      const res = await fetch(notesUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        throw new Error(`GitLab POST note failed: HTTP ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as GitLabNote;
    },
    async updateMrNote({ noteId, body }) {
      const res = await fetch(`${notesUrl}/${noteId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        throw new Error(`GitLab PUT note failed: HTTP ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as GitLabNote;
    },
  };
}

// ---------------------------------------------------------------------------
// Markdown body
// ---------------------------------------------------------------------------

/**
 * Render a Markdown body summarising the diagnostics. Mirrors the GitHub
 * Action's renderer's tone (heading + summary line + table) but stays inside
 * the CLI package so we don't pull in the Action's deps. Pure: no I/O.
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

export function parseGitlabArgs(argv: string[]): ParsedArgs {
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
  console.log(`\n${BLD}chemag ci gitlab [--input <file>] [--workspace <name>]${R}\n`);
  console.log("Post a sticky chemag comment on the current GitLab MR.\n");
  console.log(`${BLD}Options:${R}`);
  console.log("  --input <file>      Read chemag --format json from <file>");
  console.log("                      (default: read from stdin).");
  console.log("  --workspace <name>  Workspace name to render in the comment heading");
  console.log("                      (default: extracted from JSON envelope).\n");
  console.log(`${BLD}Required environment:${R}`);
  console.log("  GITLAB_TOKEN, CI_PROJECT_ID, CI_MERGE_REQUEST_IID.");
  console.log("  CI_API_V4_URL is optional (defaults to https://gitlab.com/api/v4).\n");
}

/**
 * Entry point — invoked by the dispatcher in `./index.ts`. Reads + validates
 * env, parses args, decodes the chemag JSON envelope from --input or stdin,
 * formats a Markdown body, and posts/updates the MR comment.
 */
export async function cmdCiGitlab(argv: string[]): Promise<void> {
  const args = parseGitlabArgs(argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let env: GitLabEnv;
  try {
    env = validateGitLabEnv();
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
      `${RED}error${R} chemag ci gitlab: failed to read input — ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(2);
    return;
  }

  let envelope: { workspace?: string; diagnostics?: InputDiagnostic[] };
  try {
    envelope = JSON.parse(raw) as { workspace?: string; diagnostics?: InputDiagnostic[] };
  } catch (e: unknown) {
    console.error(
      `${RED}error${R} chemag ci gitlab: input is not valid JSON — ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(2);
    return;
  }

  const diagnostics = envelope.diagnostics ?? [];
  const workspaceName = args.workspaceName ?? envelope.workspace ?? undefined;

  const body = formatBody(diagnostics, workspaceName);
  const api = makeGitLabApi(env);

  try {
    const r = await postOrUpdateMrComment(api, body);
    console.log(
      `chemag ci gitlab: ${r.action} note ${r.noteId} on MR !${env.mrIid} (${diagnostics.length} diagnostic(s)).`,
    );
    process.exit(0);
  } catch (e: unknown) {
    console.error(
      `${RED}error${R} chemag ci gitlab: ${e instanceof Error ? e.message : String(e)}`,
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
