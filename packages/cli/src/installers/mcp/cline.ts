// ---------------------------------------------------------------------------
// Cline MCP-client adapter — JSON-write only.
//
// Cline is a VS Code extension that reads MCP config from a per-OS settings
// directory. The verified canonical paths (per Cline's MCP docs at WP-017
// implementation time):
//   project scope → `<workspaceDir>/.cline/mcp.json`
//   user scope    → `~/.cline/mcp.json`
//
// VS Code's "globalStorage" path varies by OS and is not stable across
// extension reinstalls — projects that need that surface can run
// `chemag mcp install --client cline --scope user` and then symlink, or
// override the location via Cline's settings UI. Storing under `~/.cline/`
// keeps the adapter platform-agnostic while still being honored by current
// Cline versions that read both paths.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildChemagEntry,
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

export interface ClineAdapterInjections {
  homedir?: () => string;
}

export function getClineConfigPath(
  scope: Scope,
  workspaceDir: string,
  homedir: () => string = os.homedir,
): string {
  if (scope === "project") return path.join(workspaceDir, ".cline", "mcp.json");
  return path.join(homedir(), ".cline", "mcp.json");
}

export function createClineAdapter(inj: ClineAdapterInjections = {}): ClientAdapter {
  const homedir = inj.homedir ?? os.homedir;
  const configPath = (scope: Scope, workspaceDir: string): string =>
    getClineConfigPath(scope, workspaceDir, homedir);

  function install(opts: ClientInstallOpts): ClientInstallResult {
    const cfgPath = configPath(opts.scope, opts.workspaceDir);
    const entry = buildChemagEntry(opts.workspaceDir);
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
      client: "cline",
      scope: opts.scope,
      configPath: cfgPath,
      changed,
      path: "json",
      notes: opts.noCli ? ["--no-cli passed (cline uses JSON-write only)"] : [],
    };
  }

  function uninstall(opts: ClientInstallOpts): ClientInstallResult {
    const cfgPath = configPath(opts.scope, opts.workspaceDir);
    if (!fs.existsSync(cfgPath)) {
      return {
        client: "cline",
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
        client: "cline",
        scope: opts.scope,
        configPath: cfgPath,
        changed: false,
        path: "json",
        notes: ["no chemag entry present; nothing to uninstall"],
      };
    }
    const stripped = removeChemagServer(existing);
    if (!opts.dryRun) {
      fs.writeFileSync(cfgPath, serializeConfig(stripped), "utf-8");
    }
    return {
      client: "cline",
      scope: opts.scope,
      configPath: cfgPath,
      changed: true,
      path: "json",
      notes: [],
    };
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
            client: "cline",
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
    return {
      client: "cline",
      scope,
      config_path: cfgPath,
      registered: entry !== null,
      server_command: renderServerCommand(entry),
      notes,
    };
  }

  return { id: "cline" as ClientId, install, uninstall, status };
}

function readConfigSafe(cfgPath: string): Record<string, unknown> | null {
  if (!fs.existsSync(cfgPath)) return null;
  return parseConfig(cfgPath, fs.readFileSync(cfgPath, "utf-8"));
}

export const clineAdapter: ClientAdapter = createClineAdapter();
