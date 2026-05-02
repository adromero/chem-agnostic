// ---------------------------------------------------------------------------
// JSON-config merge utility shared by the MCP-client installers (claude /
// cursor / cline / continue).
//
// Each chemag-installed MCP server entry is tagged `_chemag: true` so an
// `--uninstall` run can remove the chemag entry without touching upstream-
// owned servers. We assume the host parser tolerates unknown keys; if any
// host ever rejects them, this module can move the tag to a sidecar file
// without changing the CLI surface (see ADR-0005 § "JSON tagging").
//
// All operations are pure (input → output) — disk I/O lives in the caller.
// ---------------------------------------------------------------------------

/** Canonical chemag MCP server identity. */
export const CHEMAG_SERVER_NAME = "chemag";

/**
 * Shape of a chemag-style server entry written to the various MCP client
 * config files. Hosts may add their own keys (env, transport, ...); we tag
 * `_chemag: true` so we can recognise our own entry on uninstall.
 */
export interface ChemagServerEntry {
  command: string;
  args: string[];
  /** Tag: chemag-installed entries set this to true. */
  _chemag: true;
  /** Free-form metadata the host may forward (env, transport, etc.). */
  [key: string]: unknown;
}

/**
 * Build the canonical chemag MCP server entry for a given workspace.
 *
 * The exposed `command` is the published binary name (`chemag`); the workspace
 * directory is passed via `--workspace <path>` so the spawned MCP server can
 * locate `workspace.yaml` regardless of cwd.
 */
export function buildChemagEntry(workspaceDir: string): ChemagServerEntry {
  return {
    command: "chemag",
    args: ["mcp", "--workspace", workspaceDir],
    _chemag: true,
  };
}

/**
 * Render the canonical chemag server command as a single human-readable
 * string. Used by `mcp status --format json` for the `server_command` field
 * and by pretty output. Spaces in the workspace path are NOT escaped — this
 * is a display string, not a re-runnable shell line.
 */
export function renderServerCommand(entry: ChemagServerEntry | null | undefined): string | null {
  if (!entry) return null;
  return [entry.command, ...entry.args].join(" ");
}

/**
 * Merge `entry` into `existing` under `mcpServers.chemag`, preserving any
 * other (non-chemag) servers already declared.
 *
 * Returns a new object — does not mutate the input.
 */
export function mergeChemagServer(
  existing: Record<string, unknown> | null | undefined,
  entry: ChemagServerEntry,
): Record<string, unknown> {
  const out: Record<string, unknown> = clone(existing ?? {});
  const servers = (out.mcpServers as Record<string, unknown> | undefined) ?? {};
  servers[CHEMAG_SERVER_NAME] = entry;
  out.mcpServers = servers;
  return out;
}

/**
 * Remove the chemag entry from `mcpServers`. If the resulting map is empty,
 * also drop the `mcpServers` key. Non-chemag entries (those without
 * `_chemag: true`) are NEVER removed, even if they happen to be keyed
 * `chemag` (defensive — pre-existing user-managed entries).
 *
 * Returns a new object — does not mutate the input.
 */
export function removeChemagServer(
  existing: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = clone(existing ?? {});
  const servers = out.mcpServers as Record<string, unknown> | undefined;
  if (!servers) return out;

  const entry = servers[CHEMAG_SERVER_NAME] as { _chemag?: boolean } | undefined;
  if (entry?._chemag === true) {
    delete servers[CHEMAG_SERVER_NAME];
  }

  if (Object.keys(servers).length === 0) {
    delete out.mcpServers;
  }

  return out;
}

/**
 * True iff `existing` contains a chemag-tagged server entry under
 * `mcpServers.chemag`.
 */
export function hasChemagServer(existing: Record<string, unknown> | null | undefined): boolean {
  const servers = (existing?.mcpServers as Record<string, unknown> | undefined) ?? null;
  if (!servers) return false;
  const entry = servers[CHEMAG_SERVER_NAME] as { _chemag?: boolean } | undefined;
  return entry?._chemag === true;
}

/**
 * Read the chemag-tagged entry, or null when absent.
 */
export function getChemagServer(
  existing: Record<string, unknown> | null | undefined,
): ChemagServerEntry | null {
  const servers = (existing?.mcpServers as Record<string, unknown> | undefined) ?? null;
  if (!servers) return null;
  const entry = servers[CHEMAG_SERVER_NAME] as ChemagServerEntry | undefined;
  if (!entry || entry._chemag !== true) return null;
  return entry;
}

/**
 * Stable serializer — JSON.stringify with 2-space indent and a trailing
 * newline. Used so install/re-install produces byte-identical output for the
 * idempotence test.
 */
export function serializeConfig(config: Record<string, unknown>): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Thrown by `parseConfig` when the file content is not valid JSON. Callers
 * surface this as `CHEM-MCP-202` and leave the file untouched.
 */
export class McpConfigInvalidJsonError extends Error {
  constructor(
    public readonly path: string,
    public readonly reason: string,
  ) {
    super(`MCP client config is not valid JSON: ${path} (${reason})`);
    this.name = "McpConfigInvalidJsonError";
  }
}

/**
 * Parse `text` as JSON. Throws `McpConfigInvalidJsonError` (the caller maps
 * this to CHEM-MCP-202) when parsing fails. Returns `{}` for empty content
 * (a common state for newly-touched config files).
 */
export function parseConfig(path: string, text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new McpConfigInvalidJsonError(path, "expected a JSON object at the root");
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof McpConfigInvalidJsonError) throw e;
    throw new McpConfigInvalidJsonError(path, (e as Error).message);
  }
}

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}
