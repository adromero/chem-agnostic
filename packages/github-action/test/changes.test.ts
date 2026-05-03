import { describe, expect, it } from "vitest";
import { listPrChangedFiles, type PullsApi } from "../src/changes";

describe("listPrChangedFiles", () => {
  it("paginates through more than per_page=100 files", async () => {
    const TOTAL = 257;
    const files = Array.from({ length: TOTAL }, (_, i) => ({
      filename: `src/file${i}.ts`,
      status: "modified" as const,
    }));
    let calls = 0;
    const pulls: PullsApi = {
      async listFiles({ per_page = 100, page = 1 }) {
        calls++;
        const start = (page - 1) * per_page;
        return { data: files.slice(start, start + per_page) };
      },
    };
    const result = await listPrChangedFiles(pulls, {
      owner: "x",
      repo: "y",
      pullNumber: 1,
    });
    expect(result).toHaveLength(TOTAL);
    expect(result[0]).toBe("src/file0.ts");
    expect(result[TOTAL - 1]).toBe(`src/file${TOTAL - 1}.ts`);
    // 257 files / 100 per page = 3 pages.
    expect(calls).toBe(3);
  });

  it("filters out removed files", async () => {
    const pulls: PullsApi = {
      async listFiles() {
        return {
          data: [
            { filename: "kept.ts", status: "modified" },
            { filename: "gone.ts", status: "removed" },
            { filename: "added.ts", status: "added" },
          ],
        };
      },
    };
    const result = await listPrChangedFiles(pulls, {
      owner: "x",
      repo: "y",
      pullNumber: 1,
    });
    expect(result).toEqual(["kept.ts", "added.ts"]);
  });

  it("stops paginating when a page comes back smaller than per_page", async () => {
    let calls = 0;
    const pulls: PullsApi = {
      async listFiles() {
        calls++;
        return { data: [{ filename: "only.ts", status: "modified" }] };
      },
    };
    await listPrChangedFiles(pulls, { owner: "x", repo: "y", pullNumber: 1 });
    expect(calls).toBe(1);
  });
});
