import { describe, expect, it } from "vitest";
import { STICKY_MARKER, hasMarker, postStickyComment, type IssuesApi } from "../src/comment";

interface FakeComment {
  id: number;
  body: string;
}

function makeIssues(initial: FakeComment[] = []): {
  api: IssuesApi;
  state: { comments: FakeComment[]; nextId: number };
  calls: { listed: number; created: number; updated: number };
} {
  const state = {
    comments: [...initial],
    nextId: Math.max(0, ...initial.map((c) => c.id)) + 1,
  };
  const calls = { listed: 0, created: 0, updated: 0 };
  const api: IssuesApi = {
    async listComments({ per_page = 100, page = 1 }) {
      calls.listed++;
      const start = (page - 1) * per_page;
      const slice = state.comments.slice(start, start + per_page);
      return { data: slice.map((c) => ({ id: c.id, body: c.body })) };
    },
    async createComment({ body }) {
      calls.created++;
      const id = state.nextId++;
      state.comments.push({ id, body });
      return { data: { id } };
    },
    async updateComment({ comment_id, body }) {
      calls.updated++;
      const target = state.comments.find((c) => c.id === comment_id);
      if (!target) throw new Error(`No comment with id ${comment_id}`);
      target.body = body;
      return { data: { id: comment_id } };
    },
  };
  return { api, state, calls };
}

describe("hasMarker", () => {
  it("matches a body whose first line is the marker", () => {
    expect(hasMarker(`${STICKY_MARKER}\nsome body`)).toBe(true);
  });
  it("matches a body with leading whitespace", () => {
    expect(hasMarker(`  ${STICKY_MARKER}\nbody`)).toBe(true);
  });
  it("does not match arbitrary mention of the marker mid-body", () => {
    expect(hasMarker(`hello\n${STICKY_MARKER}\nworld`)).toBe(false);
  });
  it("rejects unrelated bodies", () => {
    expect(hasMarker("just a normal comment")).toBe(false);
  });
});

describe("postStickyComment idempotency", () => {
  it("creates a fresh comment when none exists, then updates in place on the second call", async () => {
    const { api, state, calls } = makeIssues();

    const first = await postStickyComment(api, {
      owner: "alfa",
      repo: "demo",
      pullNumber: 7,
      body: "first body",
      mode: "sticky",
    });
    expect(first.action).toBe("created");
    expect(state.comments).toHaveLength(1);
    expect(state.comments[0].body.startsWith(STICKY_MARKER)).toBe(true);

    const second = await postStickyComment(api, {
      owner: "alfa",
      repo: "demo",
      pullNumber: 7,
      body: "second body",
      mode: "sticky",
    });
    expect(second.action).toBe("updated");
    expect(second.commentId).toBe(first.commentId);
    expect(state.comments).toHaveLength(1);
    expect(state.comments[0].body).toContain("second body");
    expect(state.comments[0].body.startsWith(STICKY_MARKER)).toBe(true);

    expect(calls.created).toBe(1);
    expect(calls.updated).toBe(1);
  });

  it('appends a fresh comment every time when mode is "append"', async () => {
    const { api, state } = makeIssues();
    await postStickyComment(api, {
      owner: "alfa",
      repo: "demo",
      pullNumber: 1,
      body: "a",
      mode: "append",
    });
    await postStickyComment(api, {
      owner: "alfa",
      repo: "demo",
      pullNumber: 1,
      body: "b",
      mode: "append",
    });
    expect(state.comments).toHaveLength(2);
  });

  it('skips when mode is "none"', async () => {
    const { api, state, calls } = makeIssues();
    const r = await postStickyComment(api, {
      owner: "x",
      repo: "y",
      pullNumber: 1,
      body: "ignored",
      mode: "none",
    });
    expect(r.action).toBe("skipped");
    expect(state.comments).toHaveLength(0);
    expect(calls.listed + calls.created + calls.updated).toBe(0);
  });

  it("skips when there is no PR (push event)", async () => {
    const { api, state } = makeIssues();
    const r = await postStickyComment(api, {
      owner: "x",
      repo: "y",
      pullNumber: null,
      body: "ignored",
      mode: "sticky",
    });
    expect(r.action).toBe("skipped");
    expect(state.comments).toHaveLength(0);
  });

  it("does not double-prepend the marker if the body already includes it", async () => {
    const { api, state } = makeIssues();
    await postStickyComment(api, {
      owner: "x",
      repo: "y",
      pullNumber: 1,
      body: `${STICKY_MARKER}\nalready marked`,
      mode: "sticky",
    });
    const occurrences = state.comments[0].body.split(STICKY_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });

  it("finds an existing chemag comment several pages deep", async () => {
    const filler: FakeComment[] = [];
    for (let i = 1; i <= 250; i++) filler.push({ id: i, body: `unrelated ${i}` });
    filler.push({ id: 999, body: `${STICKY_MARKER}\nold body` });
    const { api, state } = makeIssues(filler);

    const r = await postStickyComment(api, {
      owner: "x",
      repo: "y",
      pullNumber: 1,
      body: "fresh",
      mode: "sticky",
    });
    expect(r.action).toBe("updated");
    expect(r.commentId).toBe(999);
    expect(state.comments.find((c) => c.id === 999)?.body).toContain("fresh");
  });
});
