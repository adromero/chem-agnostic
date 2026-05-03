// ---------------------------------------------------------------------------
// Tests for `chemag ci bitbucket`. The poster is split into pure pieces
// (validateBitbucketEnv, formatBody, postOrUpdateComment, findChemagComment)
// so most tests construct a fake BitbucketApi and assert against the recorded
// calls. A second cluster pokes the production REST plumbing through a
// stubbed global fetch so we pin the three Bitbucket-specific shapes that
// would silently drift if a worker copy-pasted from gitlab.ts:
//   - request body uses { content: { raw } }, NOT { body }
//   - auth header is `Bearer ...`, NOT `PRIVATE-TOKEN: ...`
//   - pagination follows the `next` cursor URL, NOT `?page=` / `?pagelen=`
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STICKY_MARKER } from "@chemag/core/ci-marker";
import {
  findChemagComment,
  formatBody,
  makeBitbucketApi,
  postOrUpdateComment,
  validateBitbucketEnv,
  type BitbucketApi,
  type BitbucketComment,
  type InputDiagnostic,
} from "../../src/ci/bitbucket.js";

// ---------------------------------------------------------------------------
// makeApi — hand-rolled BitbucketApi fake. Mirrors the gitlab.test.ts
// scaffolding so the two integrations look the same to a reader. Tracks call
// counts and presents `listComments` as an async generator so the production
// poster can iterate it without thinking about pagination.
// ---------------------------------------------------------------------------

function makeApi(initial: BitbucketComment[] = []): {
  api: BitbucketApi;
  state: { comments: BitbucketComment[]; nextId: number };
  calls: { listed: number; created: number; updated: number };
} {
  const state = {
    comments: [...initial],
    nextId: Math.max(0, ...initial.map((c) => c.id)) + 1,
  };
  const calls = { listed: 0, created: 0, updated: 0 };

  const api: BitbucketApi = {
    async *listComments() {
      calls.listed++;
      for (const c of state.comments) yield c;
    },
    async createComment(body) {
      calls.created++;
      const comment: BitbucketComment = { id: state.nextId++, content: { raw: body } };
      state.comments.push(comment);
      return comment;
    },
    async updateComment(id, body) {
      calls.updated++;
      const target = state.comments.find((c) => c.id === id);
      if (!target) throw new Error(`No comment with id ${id}`);
      target.content = { raw: body };
      return target;
    },
  };
  return { api, state, calls };
}

// ---------------------------------------------------------------------------
// validateBitbucketEnv
// ---------------------------------------------------------------------------

describe("validateBitbucketEnv", () => {
  it("returns the parsed env when all required variables are set", () => {
    const r = validateBitbucketEnv({
      BITBUCKET_TOKEN: "btkn-xxxx",
      BITBUCKET_REPO_FULL_NAME: "my-ws/my-repo",
      BITBUCKET_PR_ID: "42",
    });
    expect(r.token).toBe("btkn-xxxx");
    expect(r.repoFullName).toBe("my-ws/my-repo");
    expect(r.prId).toBe("42");
  });

  it("throws naming the missing variable when BITBUCKET_TOKEN is absent", () => {
    expect(() =>
      validateBitbucketEnv({
        BITBUCKET_REPO_FULL_NAME: "ws/repo",
        BITBUCKET_PR_ID: "1",
      } as NodeJS.ProcessEnv),
    ).toThrowError(/BITBUCKET_TOKEN/);
  });

  it("throws naming all missing variables at once", () => {
    expect(() => validateBitbucketEnv({} as NodeJS.ProcessEnv)).toThrowError(
      /BITBUCKET_TOKEN.*BITBUCKET_REPO_FULL_NAME.*BITBUCKET_PR_ID/,
    );
  });

  it("treats an empty-string BITBUCKET_TOKEN as missing (Pipelines passes unset masks as '')", () => {
    expect(() =>
      validateBitbucketEnv({
        BITBUCKET_TOKEN: "",
        BITBUCKET_REPO_FULL_NAME: "ws/repo",
        BITBUCKET_PR_ID: "1",
      }),
    ).toThrowError(/BITBUCKET_TOKEN/);
  });

  it("treats an empty-string BITBUCKET_REPO_FULL_NAME as missing", () => {
    expect(() =>
      validateBitbucketEnv({
        BITBUCKET_TOKEN: "t",
        BITBUCKET_REPO_FULL_NAME: "",
        BITBUCKET_PR_ID: "1",
      }),
    ).toThrowError(/BITBUCKET_REPO_FULL_NAME/);
  });

  it("treats an empty-string BITBUCKET_PR_ID as missing", () => {
    expect(() =>
      validateBitbucketEnv({
        BITBUCKET_TOKEN: "t",
        BITBUCKET_REPO_FULL_NAME: "ws/repo",
        BITBUCKET_PR_ID: "",
      }),
    ).toThrowError(/BITBUCKET_PR_ID/);
  });
});

// ---------------------------------------------------------------------------
// postOrUpdateComment — sticky-comment idempotency
// ---------------------------------------------------------------------------

describe("postOrUpdateComment", () => {
  it("creates a fresh comment when no chemag comment exists", async () => {
    const { api, state, calls } = makeApi();

    const r = await postOrUpdateComment(api, "hello");

    expect(r.action).toBe("created");
    expect(state.comments).toHaveLength(1);
    expect(state.comments[0].content?.raw?.startsWith(STICKY_MARKER)).toBe(true);
    expect(state.comments[0].content?.raw).toContain("hello");
    expect(calls.created).toBe(1);
    expect(calls.updated).toBe(0);
  });

  it("updates the existing chemag comment in place on the second call", async () => {
    const { api, state, calls } = makeApi();

    const first = await postOrUpdateComment(api, "first");
    const second = await postOrUpdateComment(api, "second");

    expect(first.action).toBe("created");
    expect(second.action).toBe("updated");
    expect(second.commentId).toBe(first.commentId);
    expect(state.comments).toHaveLength(1);
    expect(state.comments[0].content?.raw).toContain("second");
    expect(state.comments[0].content?.raw).not.toContain("first");
    expect(calls.created).toBe(1);
    expect(calls.updated).toBe(1);
  });

  it("does not double-prepend the marker if body already includes it", async () => {
    const { api, state } = makeApi();
    await postOrUpdateComment(api, `${STICKY_MARKER}\nalready marked`);
    const raw = state.comments[0].content?.raw ?? "";
    const occurrences = raw.split(STICKY_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// findChemagComment — Bitbucket-specific filter (skip inline + skip parent)
//
// Bitbucket comments do NOT carry a `system` flag like GitLab. A
// gitlab-style `system === true` skip would be a no-op here. Instead we must
// reject:
//   - inline review threads (carry an `inline` object)
//   - reply comments (carry a `parent.id`)
// Without these skips the poster would update the wrong comment (or create
// a duplicate next run).
// ---------------------------------------------------------------------------

describe("findChemagComment filter", () => {
  it("skips inline review comments even if their content carries the marker", async () => {
    const { api } = makeApi([
      {
        id: 1,
        content: { raw: `${STICKY_MARKER}\nignore me — inline review` },
        inline: { path: "src/foo.ts", to: 12 },
      },
    ]);

    const found = await findChemagComment(api);
    expect(found).toBeNull();
  });

  it("skips reply comments (parent set) even if their content carries the marker", async () => {
    const { api } = makeApi([
      {
        id: 2,
        content: { raw: `${STICKY_MARKER}\nignore me — reply` },
        parent: { id: 1 },
      },
    ]);

    const found = await findChemagComment(api);
    expect(found).toBeNull();
  });

  it("returns the first top-level non-inline comment carrying the marker", async () => {
    const { api } = makeApi([
      // unrelated user comment — no marker
      { id: 1, content: { raw: "lgtm" } },
      // inline review with marker — must be skipped
      {
        id: 2,
        content: { raw: `${STICKY_MARKER}\ndecoy inline` },
        inline: { path: "x.ts", to: 5 },
      },
      // reply with marker — must be skipped
      {
        id: 3,
        content: { raw: `${STICKY_MARKER}\ndecoy reply` },
        parent: { id: 1 },
      },
      // genuine top-level chemag comment — this is what we want
      { id: 4, content: { raw: `${STICKY_MARKER}\nthe real one` } },
    ]);

    const found = await findChemagComment(api);
    expect(found?.id).toBe(4);
  });

  it("returns null when no comment carries the marker", async () => {
    const { api } = makeApi([{ id: 1, content: { raw: "lgtm" } }]);
    const found = await findChemagComment(api);
    expect(found).toBeNull();
  });

  it("ignores comments whose content.raw is missing or empty", async () => {
    const { api } = makeApi([
      { id: 1 }, // no content at all
      { id: 2, content: {} }, // content present but no raw
      { id: 3, content: { raw: "" } }, // empty raw
    ]);
    const found = await findChemagComment(api);
    expect(found).toBeNull();
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
      [{ level: "error", code: "CHEM-X-1", message: "bad | message | with pipes" }],
      "ws",
    );
    expect(md).toContain("bad \\| message \\| with pipes");
  });

  it("falls back to 'workspace' when no name is provided", () => {
    const md = formatBody([], undefined);
    expect(md).toContain("### chemag — `workspace`");
  });
});

// ---------------------------------------------------------------------------
// makeBitbucketApi — REST plumbing.
//
// These tests stub global fetch so we can pin the THREE Bitbucket-specific
// shapes that would silently drift if a worker copy-pasted from gitlab.ts:
//
//   1. body uses `{ content: { raw } }` (NOT `{ body }`)
//   2. auth header is `Bearer <token>` (NOT `PRIVATE-TOKEN: <token>`)
//   3. pagination follows the `next` cursor URL (NOT `?page=` / `?pagelen=`)
// ---------------------------------------------------------------------------

describe("makeBitbucketApi REST shape", () => {
  type FetchInput = Parameters<typeof fetch>[0];
  type FetchInit = Parameters<typeof fetch>[1];

  const env = {
    token: "secret-token",
    repoFullName: "my-ws/my-repo",
    prId: "42",
  };

  const expectedBaseUrl =
    "https://api.bitbucket.org/2.0/repositories/my-ws/my-repo/pullrequests/42/comments";

  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function ok<T>(body: T): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("createComment sends { content: { raw } } as the JSON body, not { body }", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: 7, content: { raw: "hello" } }));
    const api = makeBitbucketApi(env);

    await api.createComment("hello");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [FetchInput, FetchInit];
    expect(url).toBe(expectedBaseUrl);
    expect(init?.method).toBe("POST");
    const sentBody = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
    expect(sentBody).toEqual({ content: { raw: "hello" } });
    expect(sentBody).not.toHaveProperty("body");
  });

  it("updateComment PUTs to /<id> with { content: { raw } }", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: 7, content: { raw: "updated" } }));
    const api = makeBitbucketApi(env);

    await api.updateComment(7, "updated");

    const [url, init] = fetchSpy.mock.calls[0] as [FetchInput, FetchInit];
    expect(url).toBe(`${expectedBaseUrl}/7`);
    expect(init?.method).toBe("PUT");
    const sentBody = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
    expect(sentBody).toEqual({ content: { raw: "updated" } });
  });

  it("sets Authorization: Bearer <token>, not PRIVATE-TOKEN", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: 1, content: { raw: "x" } }));
    const api = makeBitbucketApi(env);

    await api.createComment("x");

    const [, init] = fetchSpy.mock.calls[0] as [FetchInput, FetchInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token");
    expect(headers).not.toHaveProperty("PRIVATE-TOKEN");
  });

  it("listComments follows response.next cursor URLs (no ?page= / ?pagelen= used)", async () => {
    // First page hands back a `next` URL pointing to page 2; page 2 has no
    // `next`, terminating iteration.
    fetchSpy
      .mockResolvedValueOnce(
        ok({
          values: [{ id: 1, content: { raw: "first" } }],
          next: `${expectedBaseUrl}?ctx=cursor-2`,
        }),
      )
      .mockResolvedValueOnce(
        ok({
          values: [{ id: 2, content: { raw: "second" } }],
        }),
      );

    const api = makeBitbucketApi(env);
    const seen: BitbucketComment[] = [];
    for await (const c of api.listComments()) seen.push(c);

    expect(seen.map((c) => c.id)).toEqual([1, 2]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Page 1 GET hits the bare base URL — no query params synthesised by us.
    const [firstUrl] = fetchSpy.mock.calls[0] as [FetchInput, FetchInit];
    expect(firstUrl).toBe(expectedBaseUrl);
    expect(String(firstUrl)).not.toContain("?page=");
    expect(String(firstUrl)).not.toContain("?pagelen=");

    // Page 2 GET hits exactly the URL Bitbucket handed us in `next`.
    const [secondUrl] = fetchSpy.mock.calls[1] as [FetchInput, FetchInit];
    expect(secondUrl).toBe(`${expectedBaseUrl}?ctx=cursor-2`);
  });

  it("listComments terminates when `next` goes undefined (single-page case)", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ values: [{ id: 1, content: { raw: "only" } }] }));

    const api = makeBitbucketApi(env);
    const seen: BitbucketComment[] = [];
    for await (const c of api.listComments()) seen.push(c);

    expect(seen).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("listComments throws when MAX_PAGES (200) is exceeded by an always-`next` response", async () => {
    // Mock fetch to hand back a perpetually-cursored response.
    fetchSpy.mockImplementation(async () => ok({ values: [], next: `${expectedBaseUrl}?loop=1` }));

    const api = makeBitbucketApi(env);
    await expect(async () => {
      for await (const _ of api.listComments()) {
        // drain
      }
    }).rejects.toThrowError(/MAX_PAGES=200/);

    // Defensive cap: we issued exactly 200 GETs before bailing.
    expect(fetchSpy).toHaveBeenCalledTimes(200);
  });

  it("listComments throws on non-2xx with a clear HTTP status message", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    const api = makeBitbucketApi(env);
    await expect(async () => {
      for await (const _ of api.listComments()) {
        // drain
      }
    }).rejects.toThrowError(/HTTP 401/);
  });

  it("createComment throws on non-2xx with a clear HTTP status message", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    const api = makeBitbucketApi(env);
    await expect(api.createComment("x")).rejects.toThrowError(/HTTP 403/);
  });
});
