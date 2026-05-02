// ---------------------------------------------------------------------------
// Session — per-server-connection state for the chemag MCP server.
//
// One Session is constructed per `createServer({ workspaceUri, ... })` call.
// The Session owns:
//   * the workspace path,
//   * a per-session ManifestCache (NEVER shared across sessions),
//   * the client-supplied vocabulary preference (Phase-1.5 "session" source),
//   * lazy access to the loaded Workspace + its compounds.
//
// Imports of the cache layer go through `@chemag/core/cache` — never via
// `@chemag/cli`. The CLI gained a workspace dep on this package as part of
// WP-014, so taking the reverse dep would create a cycle. The relocation in
// Step 0 of WP-014 moved the cache into @chemag/core specifically to break
// that loop.
//
// Vocabulary precedence — see packages/core/src/vocabulary/index.ts header
// for the full table. Short version: flag > env > workspace > session >
// default. The Session sets `setVocabulary(name, "session")` if the client
// supplied one; a workspace.yaml `vocabulary:` field still wins because the
// workspace rank is strictly greater than session.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createManifestCache, type ManifestCache } from "@chemag/core/cache";
import {
  applyWorkspaceVocabulary,
  setVocabulary,
  type VocabularyName,
} from "@chemag/core/vocabulary";
import { discoverCompounds, loadCompound, loadWorkspace } from "@chemag/core/loader";
import type { Compound, LoadedCompound, Workspace } from "@chemag/core/types";
import type { Watcher } from "./watcher.js";

/** Construction options for `Session`. */
export interface SessionOptions {
  /**
   * Absolute or relative path to the workspace directory (the directory
   * containing workspace.yaml). Required.
   */
  workspaceDir: string;
  /**
   * Optional vocabulary name supplied by the client at `initialize` time.
   * When present, the session tries to apply it via `setVocabulary(name,
   * "session")`. A workspace.yaml-declared vocabulary still beats this.
   */
  vocabulary?: VocabularyName;
  /**
   * Optional client name (from MCP `initialize.params.clientInfo.name`).
   * Stored for telemetry / logging hooks; never persisted on disk.
   */
  clientName?: string;
}

/**
 * Per-connection MCP server state. Construct one per `createServer` call;
 * never reuse across distinct workspaces.
 */
export class Session {
  /**
   * Stable per-Session identifier — used as the SubscriptionManager's
   * subscriber key and for any future per-connection log correlation.
   * Generated once at construction; never re-assigned.
   */
  readonly id: string;
  readonly workspaceDir: string;
  readonly clientName: string | null;
  readonly cache: ManifestCache;

  /**
   * The optional file watcher created on first resource subscribe (WP-016).
   * `dispose()` closes it. Stays `null` until the resource layer attaches
   * one — sessions that never subscribe never spin a watcher up.
   */
  watcher: Watcher | null = null;

  private _vocabulary: VocabularyName;
  private _workspace: Workspace | null = null;
  private _compounds: LoadedCompound[] | null = null;
  private _disposed = false;

  constructor(opts: SessionOptions) {
    this.id = randomUUID();
    this.workspaceDir = path.resolve(opts.workspaceDir);
    this.clientName = opts.clientName ?? null;
    // Per-session cache root — the cache directory is workspace-scoped, so
    // two sessions on the same workspace share on-disk state but each
    // session keeps its own in-memory wrapper. Two sessions on DIFFERENT
    // workspaces are fully isolated.
    this.cache = createManifestCache(this.workspaceDir);

    // Phase 1.5 — if the client hinted at a vocabulary, install it as
    // "session". A workspace.yaml that declares its own vocabulary will
    // override this in loadWorkspace() below.
    if (opts.vocabulary) {
      setVocabulary(opts.vocabulary, "session");
    }
    this._vocabulary = opts.vocabulary ?? "standard";
  }

  /** Vocabulary name the client requested (NOT necessarily what's active). */
  get vocabulary(): VocabularyName {
    return this._vocabulary;
  }

  /**
   * Load (and memoize) the workspace.yaml. After resolution the active
   * vocabulary is updated via `applyWorkspaceVocabulary` — the "workspace"
   * source rank outranks "session", so a workspace declaration wins over
   * the client hint.
   */
  async loadWorkspace(): Promise<Workspace> {
    this.assertNotDisposed();
    if (this._workspace !== null) return this._workspace;

    const wsPath = path.join(this.workspaceDir, "workspace.yaml");
    const ws = loadWorkspace(wsPath);
    this._workspace = ws;
    applyWorkspaceVocabulary(ws);
    return ws;
  }

  /** Discover all compounds in the workspace, memoized for this session. */
  async listCompounds(): Promise<LoadedCompound[]> {
    this.assertNotDisposed();
    if (this._compounds !== null) return this._compounds;
    const ws = await this.loadWorkspace();
    this._compounds = discoverCompounds(ws, this.workspaceDir);
    return this._compounds;
  }

  /**
   * Return the compound with the given name, or null when no such compound
   * exists. Re-uses the discoverCompounds memo when possible; falls back to
   * a single loadCompound call otherwise.
   */
  async getCompound(name: string): Promise<Compound | null> {
    this.assertNotDisposed();
    const compounds = await this.listCompounds();
    const hit = compounds.find((c) => c.manifest.compound === name);
    if (hit) return hit.manifest;

    // Defensive: try a direct loadCompound against the conventional path
    // before giving up. discoverCompounds already walks the workspace, so a
    // miss here almost certainly means the compound doesn't exist.
    try {
      const ws = await this.loadWorkspace();
      const compoundsRoot = path.resolve(this.workspaceDir, ws.paths.compounds);
      const manifestPath = path.join(compoundsRoot, name, "compound.yaml");
      const loaded = loadCompound(manifestPath);
      return loaded.manifest;
    } catch {
      return null;
    }
  }

  /**
   * Drop the in-memory loaded-workspace + compounds memos. Called by the
   * resource layer when the watcher reports a workspace.yaml or
   * compound.yaml change — the next `loadWorkspace` / `listCompounds` call
   * will re-discover from source. The on-disk cache layer is invalidated
   * separately via `cache.invalidateWorkspace` / `cache.invalidateCompound`.
   */
  invalidateLoadedWorkspace(): void {
    this._workspace = null;
    this._compounds = null;
  }

  /**
   * Release session resources. After dispose, accessor methods throw. The
   * disk cache is intentionally NOT wiped — multiple sessions and CLI runs
   * share that surface and the cache TTL handles invalidation.
   *
   * The file watcher (if any was attached by the resource layer) is closed.
   * `dispose()` returns synchronously; the watcher's close is fire-and-forget
   * because chokidar's close is best-effort once the OS handles are dropped.
   */
  dispose(): void {
    this._disposed = true;
    this._workspace = null;
    this._compounds = null;
    if (this.watcher !== null) {
      const w = this.watcher;
      this.watcher = null;
      // Fire-and-forget; we don't want to make dispose() async for a single
      // session's worth of file watchers. Errors are swallowed.
      void w.close().catch(() => {});
    }
  }

  /** True when `dispose()` has been called on this session. */
  get disposed(): boolean {
    return this._disposed;
  }

  private assertNotDisposed(): void {
    if (this._disposed) {
      throw new Error("Session has been disposed; create a new server to continue.");
    }
  }
}
