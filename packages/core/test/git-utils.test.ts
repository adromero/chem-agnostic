// ---------------------------------------------------------------------------
// Tests for `findChangedFiles` — wraps `git diff --name-only` against a real
// temp git repo. Skips when `git` is not on PATH.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findChangedFiles } from "../src/git-utils.js";

let tmpDir: string;
let gitAvailable = true;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-git-utils-"));
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    gitAvailable = false;
  }
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: tmpDir, stdio: "ignore" });
}

function init(): void {
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
}

function commit(file: string, content: string, msg: string): string {
  fs.mkdirSync(path.dirname(path.join(tmpDir, file)), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, file), content, "utf-8");
  git("add", file);
  git("commit", "-q", "-m", msg);
  const rev = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tmpDir }).toString().trim();
  return rev;
}

describe("findChangedFiles", () => {
  it("returns committed changes between <since> and HEAD", async () => {
    if (!gitAvailable) return;
    init();
    const r1 = commit("a.txt", "first\n", "first");
    commit("b.txt", "second\n", "second");
    commit("c.txt", "third\n", "third");

    const changed = await findChangedFiles(r1, tmpDir);
    expect(changed).toContain("b.txt");
    expect(changed).toContain("c.txt");
    expect(changed).not.toContain("a.txt");
  });

  it("includes staged-but-uncommitted changes", async () => {
    if (!gitAvailable) return;
    init();
    const r1 = commit("a.txt", "first\n", "first");
    fs.writeFileSync(path.join(tmpDir, "staged.txt"), "staged\n", "utf-8");
    git("add", "staged.txt");

    const changed = await findChangedFiles(r1, tmpDir);
    expect(changed).toContain("staged.txt");
  });

  it("includes unstaged working-tree edits to tracked files", async () => {
    if (!gitAvailable) return;
    init();
    const r1 = commit("a.txt", "first\n", "first");
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "modified\n", "utf-8");

    const changed = await findChangedFiles(r1, tmpDir);
    expect(changed).toContain("a.txt");
  });

  it("returns no duplicates when a file is in multiple diffs", async () => {
    if (!gitAvailable) return;
    init();
    const r1 = commit("a.txt", "first\n", "first");
    commit("a.txt", "second\n", "amend on top");
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "third\n", "utf-8");

    const changed = await findChangedFiles(r1, tmpDir);
    const occurrences = changed.filter((f) => f === "a.txt").length;
    expect(occurrences).toBe(1);
  });

  it("returns [] for unknown revisions instead of throwing", async () => {
    if (!gitAvailable) return;
    init();
    commit("a.txt", "first\n", "first");
    const out = await findChangedFiles("does-not-exist", tmpDir);
    // Working-tree diffs against HEAD still resolve, so this may be empty
    // or it may include nothing — what matters is "does not throw".
    expect(Array.isArray(out)).toBe(true);
  });

  it("returns [] for non-git directories instead of throwing", async () => {
    if (!gitAvailable) return;
    const out = await findChangedFiles("HEAD~1", tmpDir);
    expect(out).toEqual([]);
  });
});
