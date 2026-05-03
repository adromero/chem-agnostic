// ---------------------------------------------------------------------------
// Tests for `chemag ci gitlab`. The poster is split into pure pieces
// (validateGitLabEnv, formatBody, postOrUpdateMrComment) so we don't need to
// stub the global fetch — tests construct a fake GitLabApi and assert
// against the recorded calls.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { STICKY_MARKER } from "@chemag/core/ci-marker";
import {
  formatBody,
  postOrUpdateMrComment,
  validateGitLabEnv,
  type GitLabApi,
  type GitLabNote,
  type InputDiagnostic,
} from "../../src/ci/gitlab.js";

// ---------------------------------------------------------------------------
// makeApi — hand-rolled GitLabApi fake, mirrors the github-action test
// scaffolding pattern so the two integrations look the same to a reader.
// ---------------------------------------------------------------------------

function makeApi(initial: GitLabNote[] = []): {
  api: GitLabApi;
  state: { notes: GitLabNote[]; nextId: number };
  calls: { listed: number; created: number; updated: number };
} {
  const state = {
    notes: [...initial],
    nextId: Math.max(0, ...initial.map((n) => n.id)) + 1,
  };
  const calls = { listed: 0, created: 0, updated: 0 };

  const api: GitLabApi = {
    async listMrNotes({ page = 1, perPage = 100 }) {
      calls.listed++;
      const start = (page - 1) * perPage;
      return state.notes.slice(start, start + perPage);
    },
    async createMrNote({ body }) {
      calls.created++;
      const note: GitLabNote = { id: state.nextId++, body };
      state.notes.push(note);
      return note;
    },
    async updateMrNote({ noteId, body }) {
      calls.updated++;
      const target = state.notes.find((n) => n.id === noteId);
      if (!target) throw new Error(`No note with id ${noteId}`);
      target.body = body;
      return target;
    },
  };
  return { api, state, calls };
}

// ---------------------------------------------------------------------------
// validateGitLabEnv
// ---------------------------------------------------------------------------

describe("validateGitLabEnv", () => {
  it("returns the parsed env when all required variables are set", () => {
    const r = validateGitLabEnv({
      GITLAB_TOKEN: "glpat-xxxx",
      CI_PROJECT_ID: "42",
      CI_MERGE_REQUEST_IID: "7",
    });
    expect(r.token).toBe("glpat-xxxx");
    expect(r.projectId).toBe("42");
    expect(r.mrIid).toBe("7");
    // Default API base when CI_API_V4_URL is absent.
    expect(r.apiBase).toBe("https://gitlab.com/api/v4");
  });

  it("respects CI_API_V4_URL for self-hosted instances and trims a trailing slash", () => {
    const r = validateGitLabEnv({
      GITLAB_TOKEN: "t",
      CI_PROJECT_ID: "1",
      CI_MERGE_REQUEST_IID: "1",
      CI_API_V4_URL: "https://gitlab.example.com/api/v4/",
    });
    expect(r.apiBase).toBe("https://gitlab.example.com/api/v4");
  });

  it("throws naming the missing variable when GITLAB_TOKEN is absent", () => {
    expect(() =>
      validateGitLabEnv({
        CI_PROJECT_ID: "42",
        CI_MERGE_REQUEST_IID: "7",
      } as NodeJS.ProcessEnv),
    ).toThrowError(/GITLAB_TOKEN/);
  });

  it("throws naming all missing variables at once", () => {
    expect(() => validateGitLabEnv({} as NodeJS.ProcessEnv)).toThrowError(
      /GITLAB_TOKEN.*CI_PROJECT_ID.*CI_MERGE_REQUEST_IID/,
    );
  });

  it("treats an empty-string GITLAB_TOKEN as missing (defensive against unset masks)", () => {
    expect(() =>
      validateGitLabEnv({
        GITLAB_TOKEN: "",
        CI_PROJECT_ID: "42",
        CI_MERGE_REQUEST_IID: "7",
      }),
    ).toThrowError(/GITLAB_TOKEN/);
  });
});

// ---------------------------------------------------------------------------
// postOrUpdateMrComment — sticky-comment idempotency
// ---------------------------------------------------------------------------

describe("postOrUpdateMrComment", () => {
  it("creates a fresh note when no chemag note exists", async () => {
    const { api, state, calls } = makeApi();

    const r = await postOrUpdateMrComment(api, "hello");

    expect(r.action).toBe("created");
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0].body.startsWith(STICKY_MARKER)).toBe(true);
    expect(state.notes[0].body).toContain("hello");
    expect(calls.created).toBe(1);
    expect(calls.updated).toBe(0);
  });

  it("updates the existing chemag note in place on the second call", async () => {
    const { api, state, calls } = makeApi();

    const first = await postOrUpdateMrComment(api, "first");
    const second = await postOrUpdateMrComment(api, "second");

    expect(first.action).toBe("created");
    expect(second.action).toBe("updated");
    expect(second.noteId).toBe(first.noteId);
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0].body).toContain("second");
    expect(state.notes[0].body).not.toContain("first");
    expect(calls.created).toBe(1);
    expect(calls.updated).toBe(1);
  });

  it("ignores system notes (e.g. 'added 1 commit')", async () => {
    const { api, state } = makeApi([
      { id: 1, body: `${STICKY_MARKER}\nshould-be-ignored`, system: true },
    ]);

    const r = await postOrUpdateMrComment(api, "fresh");

    // The system note's marker must NOT make us update it; instead we create.
    expect(r.action).toBe("created");
    expect(state.notes).toHaveLength(2);
  });

  it("does not double-prepend the marker if body already includes it", async () => {
    const { api, state } = makeApi();
    await postOrUpdateMrComment(api, `${STICKY_MARKER}\nalready marked`);
    const occurrences = state.notes[0].body.split(STICKY_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });

  it("walks pagination to find a chemag note several pages deep", async () => {
    const filler: GitLabNote[] = [];
    for (let i = 1; i <= 250; i++) filler.push({ id: i, body: `unrelated ${i}` });
    filler.push({ id: 999, body: `${STICKY_MARKER}\nold body` });

    const { api, state } = makeApi(filler);
    const r = await postOrUpdateMrComment(api, "fresh");

    expect(r.action).toBe("updated");
    expect(r.noteId).toBe(999);
    expect(state.notes.find((n) => n.id === 999)?.body).toContain("fresh");
  });
});

// ---------------------------------------------------------------------------
// formatBody — Markdown shape
// ---------------------------------------------------------------------------

describe("formatBody", () => {
  it("congratulates the user when the diagnostics list is empty", () => {
    const md = formatBody([], "demo-workspace");
    expect(md).toContain("### chemag — `demo-workspace`");
    expect(md).toContain("No architectural violations detected");
    // No table rendered.
    expect(md).not.toContain("| Level |");
  });

  it("renders a table row per diagnostic with code + file:line + message", () => {
    const diags: InputDiagnostic[] = [
      {
        level: "error",
        code: "CHEM-BOND-001",
        message: "forbidden import",
        file: "src/a.ts",
        line: 12,
        compound: "orders",
      },
      {
        level: "warning",
        code: "CHEM-PUBLIC-002",
        message: "deep import detected",
        file: "src/b.ts",
      },
    ];
    const md = formatBody(diags, "shop");

    expect(md).toContain("**1** error(s), **1** warning(s).");
    expect(md).toContain("| Level | Code | File | Message |");
    expect(md).toContain("| error | `CHEM-BOND-001` | src/a.ts:12 | forbidden import |");
    expect(md).toContain("| warning | `CHEM-PUBLIC-002` | src/b.ts | deep import detected |");
  });

  it("escapes pipe characters in the message so the table row stays valid", () => {
    const md = formatBody(
      [
        {
          level: "error",
          code: "CHEM-X-1",
          message: "bad | message | with pipes",
        },
      ],
      "ws",
    );
    expect(md).toContain("bad \\| message \\| with pipes");
  });

  it("falls back to 'workspace' when no name is provided", () => {
    const md = formatBody([], undefined);
    expect(md).toContain("### chemag — `workspace`");
  });
});
