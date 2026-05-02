// ---------------------------------------------------------------------------
// `chemag mcp install` / `chemag mcp uninstall` / `chemag mcp status` —
// register chemag's MCP server with an MCP-aware client.
//
// Two registration paths per client (NEVER silent fallback — see
// docs/adrs/0005-mcp-registration.md):
//   Path A — client CLI present AND `--no-cli` not passed:
//     spawn the client's CLI (today: `claude mcp add ...`). Non-zero exit →
//     emit CHEM-MCP-203 ERROR and exit non-zero.
//   Path B — client CLI absent OR `--no-cli` passed:
//     write the client's MCP config JSON file directly with
//     `mcpServers.chemag = { command, args, _chemag: true }`.
//
// The four supported clients are `claude`, `cursor`, `cline`, `continue`.
// Use `--client all` to fan out across every adapter.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { tr } from "@chemag/core/vocabulary";
import { emit as emitTelemetry } from "@chemag/telemetry";
import {
  ALL_CLIENTS,
  type ClientId,
  type ClientInstallOpts,
  type ClientInstallResult,
  type ClientStatus,
  type Scope,
  lookupAdapter,
} from "../installers/mcp/index.js";
import { ClaudeCliFailedError } from "../installers/mcp/claude.js";
import { McpConfigInvalidJsonError } from "../installers/mcp/_json-merge.js";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const YLW = "\x1b[33m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

type Format = "pretty" | "json";

interface InstallArgs {
  clients: ClientId[];
  scope: Scope;
  workspace: string;
  noCli: boolean;
  dryRun: boolean;
  help: boolean;
}

interface StatusArgs {
  format: Format;
  scope: Scope;
  workspace: string;
  help: boolean;
}

// ---------------------------------------------------------------------------
// Public dispatchers
// ---------------------------------------------------------------------------

export function cmdMcpInstall(argv: string[]): number {
  return runInstallOrUninstall(argv, "install");
}

export function cmdMcpUninstall(argv: string[]): number {
  return runInstallOrUninstall(argv, "uninstall");
}

export function cmdMcpStatus(argv: string[]): number {
  let parsed: StatusArgs;
  try {
    parsed = parseStatusArgs(argv);
  } catch (e) {
    console.error(`${RED}${(e as Error).message}${R}`);
    return 2;
  }
  if (parsed.help) {
    printStatusHelp();
    return 0;
  }

  const workspaceDir = path.resolve(parsed.workspace);
  const rows: ClientStatus[] = [];
  for (const id of ALL_CLIENTS) {
    const adapter = lookupAdapter(id);
    if (!adapter) continue;
    try {
      rows.push(adapter.status(parsed.scope, workspaceDir));
    } catch (e) {
      // Status errors do NOT exit non-zero — surface them in `notes`.
      rows.push({
        client: id,
        scope: parsed.scope,
        config_path: "",
        registered: false,
        server_command: null,
        notes: [`status error: ${(e as Error).message}`],
      });
    }
  }

  if (parsed.format === "json") {
    console.log(JSON.stringify({ clients: rows }, null, 2));
  } else {
    renderStatusPretty(rows);
  }

  void emitTelemetry("cli.command.mcp_install", { action: "status" }).catch(() => {});

  return 0;
}

// ---------------------------------------------------------------------------
// install/uninstall internals
// ---------------------------------------------------------------------------

function runInstallOrUninstall(argv: string[], op: "install" | "uninstall"): number {
  let parsed: InstallArgs;
  try {
    parsed = parseInstallArgs(argv);
  } catch (e) {
    console.error(`${RED}${(e as Error).message}${R}`);
    return 2;
  }

  if (parsed.help) {
    printInstallHelp(op);
    return 0;
  }

  if (parsed.clients.length === 0) {
    console.error(`${RED}--client is required (one of claude|cursor|cline|continue|all)${R}`);
    return 2;
  }

  const workspaceDir = path.resolve(parsed.workspace);
  const opts = (client: ClientId): ClientInstallOpts => ({
    client,
    scope: parsed.scope,
    workspaceDir,
    noCli: parsed.noCli,
    dryRun: parsed.dryRun,
  });

  const results: { client: ClientId; result?: ClientInstallResult; error?: Error }[] = [];
  let exitCode = 0;

  console.log(`\n${BLD}chemag mcp ${op}${R}${parsed.dryRun ? ` ${DIM}(dry run)${R}` : ""}`);
  console.log(`  ${DIM}scope:${R}     ${parsed.scope}`);
  console.log(`  ${DIM}workspace:${R} ${workspaceDir}`);
  if (parsed.noCli) console.log(`  ${DIM}flags:${R}     --no-cli`);
  console.log("");

  for (const client of parsed.clients) {
    const adapter = lookupAdapter(client);
    if (!adapter) {
      console.error(
        `${RED}CHEM-MCP-201:${R} ${tr("diagnostic.mcp_client_unknown", {
          client,
          supported: ALL_CLIENTS.join("|"),
        })}`,
      );
      exitCode = 2;
      continue;
    }
    try {
      const result =
        op === "install" ? adapter.install(opts(client)) : adapter.uninstall(opts(client));
      results.push({ client, result });
      renderClientResult(client, op, result);
    } catch (e) {
      results.push({ client, error: e as Error });
      if (e instanceof ClaudeCliFailedError) {
        console.error(
          `${RED}CHEM-MCP-203:${R} ${tr("diagnostic.mcp_client_cli_failed", {
            cli: e.cli,
            exitCode: String(e.exitCode),
            stderr: e.stderr,
          })}`,
        );
        exitCode = 2;
        continue;
      }
      if (e instanceof McpConfigInvalidJsonError) {
        console.error(
          `${RED}CHEM-MCP-202:${R} ${tr("diagnostic.mcp_client_config_invalid_json", {
            path: e.path,
            reason: e.reason,
          })}`,
        );
        exitCode = 2;
        continue;
      }
      console.error(`${RED}mcp ${op} failed for ${client}:${R} ${(e as Error).message}`);
      exitCode = 2;
    }
  }

  // Telemetry: one event per dispatch (not per client).
  void emitTelemetry("cli.command.mcp_install", {
    action: op,
    scope: parsed.scope,
    clients: parsed.clients.join(","),
    no_cli: parsed.noCli ? "1" : "0",
    dry_run: parsed.dryRun ? "1" : "0",
  }).catch(() => {});

  return exitCode;
}

function renderClientResult(
  client: ClientId,
  op: "install" | "uninstall",
  result: ClientInstallResult,
): void {
  const verb = result.changed ? (op === "install" ? "registered" : "removed") : "no change";
  const color = result.changed ? GRN : DIM;
  console.log(`  ${color}${client.padEnd(10)}${R} ${DIM}${result.path}${R}  ${verb}`);
  console.log(`    ${DIM}path:${R} ${result.configPath}`);
  for (const note of result.notes) {
    console.log(`    ${DIM}note:${R} ${note}`);
  }
}

function renderStatusPretty(rows: ClientStatus[]): void {
  console.log(`\n${BLD}chemag mcp status${R}\n`);
  // header
  console.log(
    `  ${DIM}${"client".padEnd(10)} ${"scope".padEnd(8)} ${"registered".padEnd(11)} path${R}`,
  );
  for (const row of rows) {
    const reg = row.registered ? `${GRN}yes${R}        ` : `${YLW}no${R}         `;
    console.log(`  ${row.client.padEnd(10)} ${row.scope.padEnd(8)} ${reg} ${row.config_path}`);
    if (row.server_command) {
      console.log(`    ${DIM}command:${R} ${row.server_command}`);
    }
    for (const note of row.notes) {
      console.log(`    ${DIM}note:${R} ${note}`);
    }
  }
}

// ---------------------------------------------------------------------------
// argv parsing
// ---------------------------------------------------------------------------

function parseInstallArgs(argv: string[]): InstallArgs {
  let clientsRaw = "";
  let scope: Scope = "project";
  let workspace = ".";
  let noCli = false;
  let dryRun = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        help = true;
        break;
      case "--client":
        clientsRaw = argv[++i] ?? "";
        break;
      case "--scope":
        scope = parseScope(argv[++i] ?? "");
        break;
      case "--workspace":
        workspace = argv[++i] ?? workspace;
        break;
      case "--no-cli":
        noCli = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      default:
        if (a.startsWith("--client=")) clientsRaw = a.slice("--client=".length);
        else if (a.startsWith("--scope=")) scope = parseScope(a.slice("--scope=".length));
        else if (a.startsWith("--workspace=")) workspace = a.slice("--workspace=".length);
        else if (a.startsWith("-")) throw new Error(`Unknown flag: ${a}`);
        break;
    }
  }

  const clients = expandClients(clientsRaw);
  return { clients, scope, workspace, noCli, dryRun, help };
}

function parseStatusArgs(argv: string[]): StatusArgs {
  let format: Format = "pretty";
  let scope: Scope = "project";
  let workspace = ".";
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        help = true;
        break;
      case "--format": {
        const v = argv[++i] ?? "";
        format = parseFormat(v);
        break;
      }
      case "--scope":
        scope = parseScope(argv[++i] ?? "");
        break;
      case "--workspace":
        workspace = argv[++i] ?? workspace;
        break;
      default:
        if (a.startsWith("--format=")) format = parseFormat(a.slice("--format=".length));
        else if (a.startsWith("--scope=")) scope = parseScope(a.slice("--scope=".length));
        else if (a.startsWith("--workspace=")) workspace = a.slice("--workspace=".length);
        else if (a.startsWith("-")) throw new Error(`Unknown flag: ${a}`);
        break;
    }
  }
  return { format, scope, workspace, help };
}

function parseScope(v: string): Scope {
  if (v === "user" || v === "project") return v;
  throw new Error(`Unknown --scope value "${v}". Use user|project.`);
}

function parseFormat(v: string): Format {
  if (v === "pretty" || v === "json") return v;
  throw new Error(`Unknown --format value "${v}". Use pretty|json.`);
}

function expandClients(raw: string): ClientId[] {
  if (raw === "") return [];
  if (raw === "all") return [...ALL_CLIENTS];
  // Allow comma-separated lists (`--client claude,cursor`).
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // We DO NOT validate here — the dispatcher emits CHEM-MCP-201 for each
  // unknown id, so the user sees a useful message rather than a parse error.
  return parts as ClientId[];
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printInstallHelp(op: "install" | "uninstall"): void {
  const trKey = op === "install" ? "cli.command.mcp_install" : "cli.command.mcp_uninstall";
  console.log(`\n${BLD}${tr(trKey)}${R}\n`);
  console.log(`${BLD}Options:${R}`);
  console.log(`  ${tr("cli.help.mcp_install.client")}`);
  console.log(`  ${tr("cli.help.mcp_install.scope")}`);
  console.log("  --workspace <path>   Workspace directory (defaults to cwd)");
  console.log(`  ${tr("cli.help.mcp_install.no_cli")}`);
  console.log(`  ${tr("cli.help.mcp_install.dry_run")}`);
}

function printStatusHelp(): void {
  console.log(`\n${BLD}${tr("cli.command.mcp_status")}${R}\n`);
  console.log(`${BLD}Options:${R}`);
  console.log(`  ${tr("cli.help.mcp_status.format")}`);
  console.log("  --scope <user|project>  Scope to inspect (defaults to project)");
  console.log("  --workspace <path>      Workspace directory (defaults to cwd)");
}
