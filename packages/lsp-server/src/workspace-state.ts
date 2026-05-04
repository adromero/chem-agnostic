// ---------------------------------------------------------------------------
// Per-client LSP server state — analogous to packages/mcp-server/src/context.ts
// but scoped to a single LSP connection.
//
// Owns:
//   * the workspace directory (resolved from `initialize.params.rootUri` /
//     `rootPath`),
//   * the runOn mode resolved from `initialize.params.initializationOptions`
//     (re-applied on `workspace/didChangeConfiguration` notifications),
//   * memoised Workspace + LoadedCompound[] (invalidated when a workspace.yaml
//     or compound.yaml changes via `workspace/didChangeWatchedFiles`).
//
// LSP only ever has ONE client per connection in our deployment (each spawned
// server process serves one VS Code window), so we keep this state at module
// scope inside `server.ts` rather than maintaining a Session map.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { discoverCompounds, loadWorkspace } from "@chemag/core";
import type { LoadedCompound, Workspace } from "@chemag/core";

export type RunOnMode = "save" | "type" | "manual";

export const DEFAULT_RUN_ON: RunOnMode = "save";

/**
 * Coerce an unknown value into a valid RunOnMode. Falls back to the default
 * (`"save"`) for anything that's not one of the three documented strings.
 */
export function coerceRunOn(value: unknown): RunOnMode {
  if (value === "save" || value === "type" || value === "manual") return value;
  return DEFAULT_RUN_ON;
}

export interface WorkspaceStateOptions {
  /** Absolute path to the directory containing workspace.yaml. */
  workspaceDir: string;
  /** Resolved runOn mode (already coerced). */
  runOn: RunOnMode;
}

/** Per-client server state. Disposed when the client disconnects. */
export class WorkspaceState {
  readonly workspaceDir: string;
  private _runOn: RunOnMode;
  private _workspace: Workspace | null = null;
  private _compounds: LoadedCompound[] | null = null;

  constructor(opts: WorkspaceStateOptions) {
    this.workspaceDir = path.resolve(opts.workspaceDir);
    this._runOn = opts.runOn;
  }

  get runOn(): RunOnMode {
    return this._runOn;
  }

  /** Update the runOn mode. Called on `workspace/didChangeConfiguration`. */
  setRunOn(mode: RunOnMode): void {
    this._runOn = mode;
  }

  /**
   * Load + memoise the workspace. Returns null when workspace.yaml is missing
   * or malformed (the server never throws into the LSP transport — it just
   * publishes an empty diagnostics list and logs).
   */
  loadWorkspace(): Workspace | null {
    if (this._workspace) return this._workspace;
    const wsPath = path.join(this.workspaceDir, "workspace.yaml");
    if (!fs.existsSync(wsPath)) return null;
    try {
      this._workspace = loadWorkspace(wsPath);
      return this._workspace;
    } catch {
      return null;
    }
  }

  /** Discover all compounds; memoised alongside the workspace. */
  listCompounds(): LoadedCompound[] {
    if (this._compounds) return this._compounds;
    const ws = this.loadWorkspace();
    if (!ws) return [];
    try {
      this._compounds = discoverCompounds(ws, this.workspaceDir);
      return this._compounds;
    } catch {
      return [];
    }
  }

  /**
   * Drop in-memory caches. Called when a workspace.yaml or compound.yaml
   * change is observed via `workspace/didChangeWatchedFiles`.
   */
  invalidate(): void {
    this._workspace = null;
    this._compounds = null;
  }
}
