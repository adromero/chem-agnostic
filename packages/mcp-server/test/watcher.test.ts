// ---------------------------------------------------------------------------
// Watcher tests — exercise the chokidar wrapper against real files in a tmp
// workspace.
//
//   * workspace.yaml change → "workspace" event
//   * compound.yaml change → "compound" event with the compound name
//   * bursty edits to the same file produce ONE event (debounce)
//   * close() makes future events silent
//   * second watcher's events don't bleed into the first
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createWatcher, type WatcherChange } from "../src/watcher.js";

let tmpRoot: string;

function writeWorkspace(dir: string): void {
  fs.writeFileSync(
    path.join(dir, "workspace.yaml"),
    [
      "workspace: t",
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
}

function writeCompound(dir: string, name: string): string {
  const cdir = path.join(dir, "src", "compounds", name);
  fs.mkdirSync(cdir, { recursive: true });
  const cpath = path.join(cdir, "compound.yaml");
  fs.writeFileSync(cpath, `compound: ${name}\n`, "utf-8");
  return cpath;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-watcher-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function tick(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("watcher — workspace.yaml change", () => {
  it("emits a 'workspace' event when workspace.yaml changes", async () => {
    writeWorkspace(tmpRoot);
    const watcher = createWatcher(tmpRoot, { debounceMs: 50, usePolling: true });
    await watcher.ready();

    const events: WatcherChange[] = [];
    watcher.onChange((c) => events.push(c));

    fs.writeFileSync(path.join(tmpRoot, "workspace.yaml"), "workspace: t\nupdated: true\n", "utf-8");
    // Generous window: chokidar's awaitWriteFinish + polling can delay
    // first-emit on fresh watchers.
    const deadline = Date.now() + 1500;
    while (events.filter((e) => e.type === "workspace").length === 0 && Date.now() < deadline) {
      await tick(50);
    }
    await watcher.close();

    const ws = events.filter((e) => e.type === "workspace");
    expect(ws.length).toBeGreaterThanOrEqual(1);
  }, 5000);
});

describe("watcher — compound.yaml change", () => {
  it("emits a 'compound' event with the directory name", async () => {
    writeWorkspace(tmpRoot);
    const cpath = writeCompound(tmpRoot, "alpha");
    const watcher = createWatcher(tmpRoot, { debounceMs: 50, usePolling: true });
    await watcher.ready();

    const events: WatcherChange[] = [];
    watcher.onChange((c) => events.push(c));

    fs.writeFileSync(cpath, "compound: alpha\nupdated: true\n", "utf-8");
    await tick(400);
    await watcher.close();

    const compoundEvents = events.filter((e): e is Extract<WatcherChange, { type: "compound" }> =>
      e.type === "compound",
    );
    expect(compoundEvents.length).toBeGreaterThanOrEqual(1);
    expect(compoundEvents[0].name).toBe("alpha");
  }, 5000);
});

describe("watcher — debounce", () => {
  it("bursts on the same workspace.yaml coalesce into one event", async () => {
    writeWorkspace(tmpRoot);
    const watcher = createWatcher(tmpRoot, { debounceMs: 200, usePolling: true });
    await watcher.ready();

    const events: WatcherChange[] = [];
    watcher.onChange((c) => events.push(c));

    // Fire 5 quick writes inside the debounce window.
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(tmpRoot, "workspace.yaml"), `workspace: t\nv: ${i}\n`, "utf-8");
      await tick(20);
    }
    await tick(500);
    await watcher.close();

    const ws = events.filter((e) => e.type === "workspace");
    // Tight target: exactly 1. Tolerate up to 2 if the platform's filesystem
    // emits split inotify events for the rapid rewrites.
    expect(ws.length).toBeGreaterThanOrEqual(1);
    expect(ws.length).toBeLessThanOrEqual(2);
  }, 5000);
});

describe("watcher — close()", () => {
  it("close() stops further events", async () => {
    writeWorkspace(tmpRoot);
    const watcher = createWatcher(tmpRoot, { debounceMs: 50, usePolling: true });
    await watcher.ready();

    const events: WatcherChange[] = [];
    watcher.onChange((c) => events.push(c));

    await watcher.close();
    fs.writeFileSync(path.join(tmpRoot, "workspace.yaml"), "workspace: t\npost: close\n", "utf-8");
    await tick(300);
    expect(events.length).toBe(0);
  }, 5000);
});

describe("watcher — isolation", () => {
  it("two watchers on different workspaces don't cross-fire", async () => {
    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-watcher2-"));
    try {
      writeWorkspace(tmpRoot);
      writeWorkspace(root2);

      const w1 = createWatcher(tmpRoot, { debounceMs: 50, usePolling: true });
      const w2 = createWatcher(root2, { debounceMs: 50, usePolling: true });
      await Promise.all([w1.ready(), w2.ready()]);

      const events1: WatcherChange[] = [];
      const events2: WatcherChange[] = [];
      w1.onChange((c) => events1.push(c));
      w2.onChange((c) => events2.push(c));

      fs.writeFileSync(path.join(tmpRoot, "workspace.yaml"), "workspace: t\nx:1\n", "utf-8");
      await tick(400);
      await Promise.all([w1.close(), w2.close()]);

      expect(events1.length).toBeGreaterThanOrEqual(1);
      expect(events2.length).toBe(0);
    } finally {
      fs.rmSync(root2, { recursive: true, force: true });
    }
  }, 5000);
});
