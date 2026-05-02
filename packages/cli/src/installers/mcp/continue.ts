// ---------------------------------------------------------------------------
// Continue MCP-client adapter — JSON-write only.
//
// Continue stores its config in a single YAML/JSON file. We use the JSON
// fork it documents as `mcpServers`-compatible (verified at WP-017
// implementation time):
//   project scope → `<workspaceDir>/.continue/mcpServers.json`
//   user scope    → `~/.continue/mcpServers.json`
//
// Continue's own config.yaml/.json supports an `mcpServers` block; we write
// the stand-alone fragment so users keep their main config un-modified. Both
// surfaces share the same canonical chemag-tagged entry.
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

export interface ContinueAdapterInjections {
  homedir?: () => string;
}

export function getContinueConfigPath(
  scope: Scope,
  workspaceDir: string,
  homedir: () => string = os.homedir,
): string {
  if (scope === "project") return path.join(workspaceDir, ".continue", "mcpServers.json");
  return path.join(homedir(), ".continue", "mcpServers.json");
}

export function createContinueAdapter(inj: ContinueAdapterInjections = {}): ClientAdapter {
  const homedir = inj.homedir ?? os.homedir;
  const configPath = (scope: Scope, workspaceDir: string): string =>
    getContinueConfigPath(scope, workspaceDir, homedir);

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
      client: "continue",
      scope: opts.scope,
      configPath: cfgPath,
      changed,
      path: "json",
      notes: opts.noCli ? ["--no-cli passed (continue uses JSON-write only)"] : [],
    };
  }

  function uninstall(opts: ClientInstallOpts): ClientInstallResult {
    const cfgPath = configPath(opts.scope, opts.workspaceDir);
    if (!fs.existsSync(cfgPath)) {
      return {
        client: "continue",
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
        client: "continue",
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
      client: "continue",
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
            client: "continue",
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
      client: "continue",
      scope,
      config_path: cfgPath,
      registered: entry !== null,
      server_command: renderServerCommand(entry),
      notes,
    };
  }

  return { id: "continue" as ClientId, install, uninstall, status };
}

function readConfigSafe(cfgPath: string): Record<string, unknown> | null {
  if (!fs.existsSync(cfgPath)) return null;
  return parseConfig(cfgPath, fs.readFileSync(cfgPath, "utf-8"));
}

export const continueAdapter: ClientAdapter = createContinueAdapter();
