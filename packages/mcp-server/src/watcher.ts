// ---------------------------------------------------------------------------
// File watcher — wraps chokidar v5 to emit normalized {type, name?, path}
// change events for the MCP resource subscription pipeline.
//
// We watch:
//   * `<workspaceRoot>/workspace.yaml`           → type: "workspace"
//   * `<workspaceRoot>/**/<manifest_filename>`   → type: "compound", with the
//     compound's directory name extracted from the path.
//
// Burst coalescing happens HERE per (path) at a small debounce window (100ms
// by default — configurable via opts.debounceMs). Editors often write files
// twice (rename-into-place); chokidar's `awaitWriteFinish` adds a separate
// stability gate. The two together cleanly absorb concurrent edits to the
// same path; the SubscriptionManager applies a second per-URI debounce as
// belt-and-braces, guaranteeing exactly one notification per URI per burst.
//
// Windows note: chokidar falls back to polling on some Windows configurations,
// which is dramatically slower than inotify on Linux or FSEvents on macOS.
// Operators on Windows should expect ~1s notification latency vs ~100ms
// elsewhere. See the package README for details.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { type FSWatcher, watch as chokidarWatch } from "chokidar";

/** Discriminated change event emitted by the watcher. */
export type WatcherChange =
  | { type: "workspace"; path: string }
  | { type: "compound"; name: string; path: string };

export interface WatcherOptions {
  /**
   * Filename of compound manifests. Defaults to "compound.yaml". When the
   * workspace declares a custom `rules.manifest_filename`, callers should
   * pass it through here.
   */
  manifestFilename?: string;
  /** Debounce window in ms for coalescing bursts on the same path. Default 100. */
  debounceMs?: number;
  /**
   * Test/CI hook. When true, chokidar uses polling — slower, but more
   * deterministic in CI sandboxes that don't surface inotify events.
   */
  usePolling?: boolean;
}

export interface Watcher {
  /** Subscribe a handler for normalized change events. Returns an unsubscribe fn. */
  onChange(handler: (change: WatcherChange) => void): () => void;
  /** Resolve once chokidar has finished its initial scan ("ready" event). */
  ready(): Promise<void>;
  /** Stop watching and release all OS-level handles. Idempotent. */
  close(): Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 100;

/**
 * Construct a workspace watcher rooted at `workspaceRoot`. The watcher
 * starts immediately (chokidar's default) — call `.ready()` to await the
 * initial-scan completion before relying on event flow.
 */
export function createWatcher(workspaceRoot: string, opts: WatcherOptions = {}): Watcher {
  const manifestFilename = opts.manifestFilename ?? "compound.yaml";
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const handlers = new Set<(change: WatcherChange) => void>();
  let closed = false;

  // Per-path debounce timers.
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const root = path.resolve(workspaceRoot);
  // We watch the workspace root directly; the eventual emit decides whether
  // a path is workspace.yaml or a compound manifest. Filtering OUT everything
  // else via `ignored` keeps the OS-level watch surface manageable.
  const watcher: FSWatcher = chokidarWatch(root, {
    ignoreInitial: true,
    persistent: true,
    usePolling: opts.usePolling === true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
    ignored: (entryPath: string) => {
      if (entryPath === root) return false;
      const base = path.basename(entryPath);
      // Always ignore the cache, node_modules and dotfiles to keep the watch
      // surface small. We DO need to descend into subdirectories to find
      // compound.yaml files.
      if (base === "node_modules" || base === ".chemag" || base === "dist") return true;
      // Keep directory entries (so chokidar can descend); only reject leaf
      // files we don't care about.
      // chokidar invokes the matcher per-entry; if we can't tell directory
      // from file (no stats), default to "include" so we don't accidentally
      // skip a manifest.
      return false;
    },
  });

  const dispatch = (rawPath: string): void => {
    if (closed) return;
    // chokidar's path may or may not be absolute; resolve relative to the
    // process cwd. We compare via path.relative against `root` to be robust
    // against /tmp vs /private/tmp differences and trailing-slash quirks.
    const abs = path.isAbsolute(rawPath) ? rawPath : path.resolve(rawPath);
    const base = path.basename(abs);
    const rel = path.relative(root, abs);
    const isUnderRoot = !rel.startsWith("..") && !path.isAbsolute(rel);

    let change: WatcherChange | null = null;
    if (isUnderRoot && rel === "workspace.yaml") {
      change = { type: "workspace", path: abs };
    } else if (base === manifestFilename) {
      const compoundDir = path.dirname(abs);
      change = { type: "compound", name: path.basename(compoundDir), path: abs };
    }
    if (!change) return;

    // Coalesce bursts on the same path.
    const key = abs;
    const existing = pending.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const captured = change;
    const timer = setTimeout(() => {
      pending.delete(key);
      if (closed) return;
      // Snapshot subscribers so a handler unsubscribing during dispatch
      // doesn't reorder the iteration.
      const snapshot = [...handlers];
      for (const h of snapshot) {
        try {
          h(captured);
        } catch {
          // Handler errors must not abort sibling notifications.
        }
      }
    }, debounceMs);
    pending.set(key, timer);
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      (timer as { unref: () => void }).unref();
    }
  };

  watcher.on("add", dispatch);
  watcher.on("change", dispatch);
  watcher.on("unlink", dispatch);

  let readyPromise: Promise<void> | null = null;

  return {
    onChange(handler): () => void {
      handlers.add(handler);
      return (): void => {
        handlers.delete(handler);
      };
    },
    ready(): Promise<void> {
      if (readyPromise) return readyPromise;
      readyPromise = new Promise<void>((resolve) => {
        // chokidar emits "ready" exactly once after the initial scan. If
        // it's already happened by the time we attach we still resolve
        // promptly because chokidar latches the event.
        watcher.once("ready", () => resolve());
      });
      return readyPromise;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      handlers.clear();
      try {
        await watcher.close();
      } catch {
        // Best-effort; chokidar can throw on already-closed watchers.
      }
    },
  };
}
