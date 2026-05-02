// ---------------------------------------------------------------------------
// Session isolation tests — two parallel sessions on different workspaces
// must not share cache state. Also covers basic loadWorkspace memoization
// and getCompound/listCompounds dispatch.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../src/index.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

let root: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-ctx-"));
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

function makeWorkspace(name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "src", "compounds"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "workspace.yaml"),
    [
      `workspace: ${name}`,
      "language: typescript",
      "roles:",
      "  element:",
      "    description: V",
      "    folder: elements",
      "bonds:",
      "  element: [element]",
      "paths:",
      "  compounds: ./src/compounds",
      "",
    ].join("\n"),
    "utf-8",
  );
  return dir;
}

describe("Session — workspace memoization", () => {
  it("loadWorkspace returns the same object on repeated calls", async () => {
    const dir = makeWorkspace("alpha");
    const s = new Session({ workspaceDir: dir });
    const a = await s.loadWorkspace();
    const b = await s.loadWorkspace();
    expect(a).toBe(b);
  });

  it("listCompounds returns an empty array for a workspace with no compounds", async () => {
    const dir = makeWorkspace("alpha");
    const s = new Session({ workspaceDir: dir });
    expect(await s.listCompounds()).toEqual([]);
  });

  it("getCompound returns null for an unknown name", async () => {
    const dir = makeWorkspace("alpha");
    const s = new Session({ workspaceDir: dir });
    expect(await s.getCompound("does-not-exist")).toBeNull();
  });
});

describe("Session — isolation across workspaces", () => {
  it("two sessions on different workspaces have independent caches", () => {
    const aDir = makeWorkspace("alpha");
    const bDir = makeWorkspace("beta");
    const a = new Session({ workspaceDir: aDir });
    const b = new Session({ workspaceDir: bDir });

    expect(a.cache).not.toBe(b.cache);
    expect(a.workspaceDir).not.toBe(b.workspaceDir);
  });

  it("two sessions on the SAME workspace get distinct cache wrappers", () => {
    const dir = makeWorkspace("alpha");
    const a = new Session({ workspaceDir: dir });
    const b = new Session({ workspaceDir: dir });
    expect(a.cache).not.toBe(b.cache);
    // ...but workspaceDir is identical, which is the on-disk identity.
    expect(a.workspaceDir).toBe(b.workspaceDir);
  });

  it("disposing one session does not affect another", async () => {
    const aDir = makeWorkspace("alpha");
    const bDir = makeWorkspace("beta");
    const a = new Session({ workspaceDir: aDir });
    const b = new Session({ workspaceDir: bDir });

    a.dispose();
    expect(a.disposed).toBe(true);
    expect(b.disposed).toBe(false);

    // The non-disposed session is still usable.
    const ws = await b.loadWorkspace();
    expect(ws.workspace).toBe("beta");
  });
});
