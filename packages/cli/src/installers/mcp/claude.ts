// ---------------------------------------------------------------------------
// Claude Code MCP-client adapter.
//
// Two registration paths (NEVER silent fallback — see ADR-0005):
//   Path A — `claude` CLI present on PATH AND `--no-cli` not passed:
//     spawn `claude mcp add [-s scope] chemag -- chemag mcp --workspace
//     <path>` (verified upstream syntax, see "Implementation Verification
//     Steps" in stages/wp-017.md). On exit 0 → success. On non-zero →
//     surface CHEM-MCP-203 as ERROR; exit non-zero. NO fallback to JSON.
//   Path B — `claude` CLI not on PATH, OR `--no-cli` was passed:
//     write `.mcp.json` (project) or `~/.claude.json` (user) directly with
//     `mcpServers.chemag = { command, args, _chemag: true }`.
//
// The `--no-cli` flag forces Path B unconditionally.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import {
  buildChemagEntry,
  CHEMAG_SERVER_NAME,
  type ChemagServerEntry,
  getChemagServer,
  hasChemagServer,
  McpConfigInvalidJsonError,
  mergeChemagServer,
  parseConfig,
  removeChemagServer,
  renderServerCommand,
  serializeConfig,
} from "./_json-merge.js";
import type {
  ClientAdapter,
  ClientId,
  ClientInstallOpts,
  ClientInstallResult,
  ClientStatus,
  Scope,
} from "./index.js";

/**
 * Pluggable spawn — the test suite injects a mock to assert exact argv
 * without ever invoking a real `claude` binary. The default delegates to
 * `child_process.spawnSync`.
 *
 * Result `stderr`/`stdout` are typed as `string | Buffer | undefined` so
 * mocks can return either form; callers normalize via `String(...)`.
 */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: SpawnSyncOptions,
) => SpawnSyncReturns<string | Buffer>;

/**
 * Pluggable PATH probe — returns true iff `claude` is resolvable on PATH.
 * The test suite injects a mock so we can simulate "CLI present" / "CLI
 * absent" deterministically without touching the host's real PATH.
 */
export type WhichFn = (binary: string) => boolean;

const defaultSpawn: SpawnFn = (cmd, args, opts) =>
  spawnSync(cmd, args as string[], opts) as SpawnSyncReturns<string | Buffer>;

/**
 * Normalize a spawn-result stderr field (Buffer | string | null/undefined) to
 * a plain string. Tests can return either shape; production gets Buffers via
 * `encoding: "buffer"`.
 */
function stderrToString(s: string | Buffer | null | undefined): string {
  if (s == null) return "";
  if (typeof s === "string") return s;
  return s.toString("utf-8");
}

const defaultWhich: WhichFn = (binary) => {
  // Cross-platform existence probe: walk PATH entries and look for
  // `<entry>/<binary>` (also `<entry>/<binary>.exe` / `.cmd` on win32).
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext.toLowerCase());
      try {
        if (fs.existsSync(candidate)) return true;
      } catch {
        // ignore
      }
    }
  }
  return false;
};

/**
 * Optional injection points so tests can substitute a mocked CLI / PATH probe.
 */
export interface ClaudeAdapterInjections {
  spawn?: SpawnFn;
  which?: WhichFn;
  /** Override `os.homedir()` — used by the test suite to point at a tmp dir. */
  homedir?: () => string;
}

/**
 * Resolve the absolute path to the JSON config file used by Path B.
 *   project → `<workspaceDir>/.mcp.json`
 *   user    → `<homedir>/.claude.json`
 */
export function getClaudeConfigPath(
  scope: Scope,
  workspaceDir: string,
  homedir: () => string = os.homedir,
): string {
  if (scope === "project") return path.join(workspaceDir, ".mcp.json");
  return path.join(homedir(), ".claude.json");
}

/**
 * The exact argv we pass to `claude mcp add`. Exposed (and asserted by tests)
 * so future upstream-syntax drift fails loudly rather than silently.
 *
 * Verified against `claude mcp add --help` at WP-017 implementation time:
 *   Usage: claude mcp add [options] <name> <commandOrUrl> [args...]
 *   -s, --scope <scope>   (local | user | project)
 *
 * Mapping: our `project` scope → `--scope project` (writes to .mcp.json);
 * our `user` scope → `--scope user`. We use the `--` separator before the
 * chemag command to keep the parser from eating any future chemag-side flags.
 */
export function buildClaudeAddArgs(
  scope: Scope,
  workspaceDir: string,
  entry: ChemagServerEntry,
): string[] {
  return ["mcp", "add", "--scope", scope, CHEMAG_SERVER_NAME, "--", entry.command, ...entry.args];
}

/**
 * Argv for `claude mcp remove chemag`. Same scope mapping as install.
 */
export function buildClaudeRemoveArgs(scope: Scope): string[] {
  return ["mcp", "remove", "--scope", scope, CHEMAG_SERVER_NAME];
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export function createClaudeAdapter(inj: ClaudeAdapterInjections = {}): ClientAdapter {
  const spawn = inj.spawn ?? defaultSpawn;
  const which = inj.which ?? defaultWhich;
  const homedir = inj.homedir ?? os.homedir;

  const configPath = (scope: Scope, workspaceDir: string): string =>
    getClaudeConfigPath(scope, workspaceDir, homedir);

  function install(opts: ClientInstallOpts): ClientInstallResult {
    const cliAvailable = !opts.noCli && which("claude");
    const entry = buildChemagEntry(opts.workspaceDir);
    const cfgPath = configPath(opts.scope, opts.workspaceDir);

    if (cliAvailable) {
      // ---- Path A ----
      const args = buildClaudeAddArgs(opts.scope, opts.workspaceDir, entry);
      if (opts.dryRun) {
        return {
          client: "claude",
          scope: opts.scope,
          configPath: cfgPath,
          changed: false,
          path: "cli",
          notes: [`would invoke: claude ${args.join(" ")}`],
        };
      }
      const res = spawn("claude", args, { encoding: "buffer" });
      if (res.error) {
        throw new ClaudeCliFailedError("claude", -1, String(res.error.message ?? res.error));
      }
      const code = res.status ?? -1;
      if (code !== 0) {
        const stderr = stderrToString(res.stderr).trim();
        throw new ClaudeCliFailedError("claude", code, stderr || `exit ${code}`);
      }
      return {
        client: "claude",
        scope: opts.scope,
        configPath: cfgPath,
        changed: true,
        path: "cli",
        notes: [],
      };
    }

    // ---- Path B ----
    return writeJsonInstall(cfgPath, entry, opts);
  }

  function uninstall(opts: ClientInstallOpts): ClientInstallResult {
    const cliAvailable = !opts.noCli && which("claude");
    const cfgPath = configPath(opts.scope, opts.workspaceDir);

    if (cliAvailable) {
      const args = buildClaudeRemoveArgs(opts.scope);
      if (opts.dryRun) {
        return {
          client: "claude",
          scope: opts.scope,
          configPath: cfgPath,
          changed: false,
          path: "cli",
          notes: [`would invoke: claude ${args.join(" ")}`],
        };
      }
      const res = spawn("claude", args, { encoding: "buffer" });
      if (res.error) {
        throw new ClaudeCliFailedError("claude", -1, String(res.error.message ?? res.error));
      }
      const code = res.status ?? -1;
      if (code !== 0) {
        const stderr = stderrToString(res.stderr).trim();
        // claude mcp remove returns non-zero when the server isn't registered.
        // We DON'T treat that as an error — surface it via notes and report
        // unchanged. Detection: stderr mentions "not found" or similar.
        if (/not found|no such|does not exist/i.test(stderr)) {
          return {
            client: "claude",
            scope: opts.scope,
            configPath: cfgPath,
            changed: false,
            path: "cli",
            notes: ["chemag was not registered with claude; nothing to remove"],
          };
        }
        throw new ClaudeCliFailedError("claude", code, stderr || `exit ${code}`);
      }
      return {
        client: "claude",
        scope: opts.scope,
        configPath: cfgPath,
        changed: true,
        path: "cli",
        notes: [],
      };
    }

    return writeJsonUninstall(cfgPath, opts);
  }

  function status(scope: Scope, workspaceDir: string): ClientStatus {
    const cfgPath = configPath(scope, workspaceDir);
    const notes: string[] = [];

    let parsed: Record<string, unknown> | null = null;
    if (!fs.existsSync(cfgPath)) {
      notes.push("config file does not exist yet");
    } else {
      try {
        parsed = parseConfig(cfgPath, fs.readFileSync(cfgPath, "utf-8"));
      } catch (e) {
        if (e instanceof McpConfigInvalidJsonError) {
          notes.push(`config file is not valid JSON: ${e.reason}`);
          return {
            client: "claude",
            scope,
            config_path: cfgPath,
            registered: false,
            server_command: null,
            notes,
          };
        }
        throw e;
      }
    }

    const entry = parsed ? getChemagServer(parsed) : null;
    if (!which("claude")) {
      notes.push("claude CLI not on PATH; inspecting JSON config file directly");
    }
    return {
      client: "claude",
      scope,
      config_path: cfgPath,
      registered: entry !== null,
      server_command: renderServerCommand(entry),
      notes,
    };
  }

  return { id: "claude" as ClientId, install, uninstall, status };
}

// ---------------------------------------------------------------------------
// Path B helpers
// ---------------------------------------------------------------------------

function writeJsonInstall(
  cfgPath: string,
  entry: ChemagServerEntry,
  opts: ClientInstallOpts,
): ClientInstallResult {
  const existing = readConfigSafe(cfgPath);
  const merged = mergeChemagServer(existing, entry);
  const serialized = serializeConfig(merged);
  const before = existing === null ? null : serializeConfig(existing);
  const changed = before !== serialized;

  if (!opts.dryRun && changed) {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, serialized, "utf-8");
  }

  return {
    client: "claude",
    scope: opts.scope,
    configPath: cfgPath,
    changed,
    path: "json",
    notes: opts.noCli
      ? ["--no-cli passed; wrote JSON config directly"]
      : ["claude CLI not on PATH; wrote JSON config directly"],
  };
}

function writeJsonUninstall(cfgPath: string, opts: ClientInstallOpts): ClientInstallResult {
  if (!fs.existsSync(cfgPath)) {
    return {
      client: "claude",
      scope: opts.scope,
      configPath: cfgPath,
      changed: false,
      path: "json",
      notes: ["config file does not exist; nothing to uninstall"],
    };
  }
  const existing = readConfigSafe(cfgPath);
  if (!existing || !hasChemagServer(existing)) {
    return {
      client: "claude",
      scope: opts.scope,
      configPath: cfgPath,
      changed: false,
      path: "json",
      notes: ["no chemag entry present; nothing to uninstall"],
    };
  }
  const stripped = removeChemagServer(existing);
  const serialized = serializeConfig(stripped);

  if (!opts.dryRun) {
    fs.writeFileSync(cfgPath, serialized, "utf-8");
  }
  return {
    client: "claude",
    scope: opts.scope,
    configPath: cfgPath,
    changed: true,
    path: "json",
    notes: [],
  };
}

function readConfigSafe(cfgPath: string): Record<string, unknown> | null {
  if (!fs.existsSync(cfgPath)) return null;
  return parseConfig(cfgPath, fs.readFileSync(cfgPath, "utf-8"));
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Raised when `claude mcp add/remove` exits non-zero. The CLI surfaces this
 * as `CHEM-MCP-203` and exits non-zero — there is NO fallback to Path B.
 */
export class ClaudeCliFailedError extends Error {
  constructor(
    public readonly cli: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`Client CLI "${cli}" exited with code ${exitCode}: ${stderr}`);
    this.name = "ClaudeCliFailedError";
  }
}

// Default adapter binding (used by index.ts registry).
export const claudeAdapter: ClientAdapter = createClaudeAdapter();
