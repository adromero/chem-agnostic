// ---------------------------------------------------------------------------
// MCP-client adapter registry. Each adapter implements `ClientAdapter`,
// providing install/uninstall/status entry points for one client.
// ---------------------------------------------------------------------------

export type ClientId = "claude" | "cursor" | "cline" | "continue";
export type Scope = "user" | "project";

export const ALL_CLIENTS: readonly ClientId[] = ["claude", "cursor", "cline", "continue"];

/**
 * Common parameters for an install/uninstall call. The `mcp install` /
 * `mcp uninstall` commands construct one of these per (client, scope) target.
 */
export interface ClientInstallOpts {
  /** The MCP client to operate on. */
  client: ClientId;
  /** Where to register: `user` (home-dir config) or `project` (workspace-dir config). */
  scope: Scope;
  /** Absolute path to the workspace directory passed via `chemag mcp --workspace ...`. */
  workspaceDir: string;
  /** When true, force the JSON-write path even if the client's CLI is on PATH. */
  noCli: boolean;
  /** When true, plan and report but do not write or invoke any CLI. */
  dryRun: boolean;
}

/**
 * Result of a single install/uninstall call. Surfaced back to the
 * `mcp install` / `mcp uninstall` command for rendering and exit-code
 * decisions.
 */
export interface ClientInstallResult {
  client: ClientId;
  scope: Scope;
  /** Absolute path to the config file that was (or would be) written. */
  configPath: string;
  /** True iff the operation actually wrote a change (or would write under !dryRun). */
  changed: boolean;
  /** Which path was taken: `cli` (Path A) or `json` (Path B). */
  path: "cli" | "json";
  /** Human-readable notes carried into pretty + json output. */
  notes: string[];
}

/**
 * One row of the public `mcp status --format json` contract. Field shape is
 * authoritative — see `packages/core/schemas/mcp-status.schema.json`.
 *
 * Field naming follows the schema exactly (`config_path` / `server_command`
 * are snake_case to match the JSON contract).
 */
export interface ClientStatus {
  client: ClientId;
  scope: Scope;
  config_path: string;
  registered: boolean;
  server_command: string | null;
  notes: string[];
}

/**
 * Per-client adapter contract. The registry below maps `ClientId` to one
 * adapter. New clients add a new key here.
 */
export interface ClientAdapter {
  id: ClientId;
  install(opts: ClientInstallOpts): ClientInstallResult;
  uninstall(opts: ClientInstallOpts): ClientInstallResult;
  status(scope: Scope, workspaceDir: string): ClientStatus;
}

import { claudeAdapter } from "./claude.js";
import { clineAdapter } from "./cline.js";
import { continueAdapter } from "./continue.js";
import { cursorAdapter } from "./cursor.js";

/**
 * The canonical client adapter registry. Index by `ClientId`.
 */
export const clientAdapters: Record<ClientId, ClientAdapter> = {
  claude: claudeAdapter,
  cursor: cursorAdapter,
  cline: clineAdapter,
  continue: continueAdapter,
};

/**
 * Type-safe lookup. Returns null for unknown ids; callers surface
 * `CHEM-MCP-201`.
 */
export function lookupAdapter(id: string): ClientAdapter | null {
  return Object.hasOwn(clientAdapters, id) ? clientAdapters[id as ClientId] : null;
}
