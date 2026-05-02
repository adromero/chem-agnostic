// ---------------------------------------------------------------------------
// `chemag mcp [--workspace <path>] [--transport stdio|sse]`
//
// Boots an MCP server from @chemag/mcp-server and binds it to the requested
// transport. The server runs in this process and stays alive until the
// transport closes (typically: client disconnects stdin, sends a shutdown
// JSON-RPC, or the process is signaled).
//
// Dynamic-imports @chemag/mcp-server so the CLI start-up cost stays low
// for users who never invoke `chemag mcp`. The static `package.json`
// dependency keeps the dep-graph honest.
//
// Adapter shape: `cmdMcp(argv): number` returns a sync exit code per the
// project's command convention. The actual server lifecycle is async, so
// the function awaits the server's run promise inside an async IIFE and
// returns 0 on graceful shutdown, non-zero on error. citty / cli.ts
// dispatch handles surfacing the code to process.exit.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { existsSync } from "node:fs";
import { tr } from "@chemag/core/vocabulary";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const BLD = "\x1b[1m";

interface ParsedArgs {
  workspace: string | null;
  transport: "stdio" | "sse";
  help: boolean;
}

/**
 * Parse the `chemag mcp` argv. Recognized flags:
 *   --workspace <path>   workspace directory (default: cwd)
 *   --transport <name>   stdio (default) | sse (errors with CHEM-MCP-002)
 *   --help / -h          help
 *
 * WP-017 will add `mcp install`, `mcp uninstall`, `mcp status` subcommands.
 * For now, the first positional is interpreted as a workspace path when
 * --workspace was not provided, matching the ergonomics of `chemag check`.
 */
export function parseMcpArgs(argv: string[]): ParsedArgs {
  let workspace: string | null = null;
  let transport: "stdio" | "sse" = "stdio";
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }
    if (a === "--workspace") {
      const v = argv[i + 1];
      if (v && !v.startsWith("-")) {
        workspace = v;
        i++;
      }
      continue;
    }
    if (a.startsWith("--workspace=")) {
      workspace = a.slice("--workspace=".length);
      continue;
    }
    if (a === "--transport") {
      const v = argv[i + 1];
      if (v && (v === "stdio" || v === "sse")) {
        transport = v;
        i++;
      }
      continue;
    }
    if (a.startsWith("--transport=")) {
      const v = a.slice("--transport=".length);
      if (v === "stdio" || v === "sse") transport = v;
      continue;
    }
    // First bare positional is treated as the workspace path when none was
    // supplied via --workspace.
    if (!a.startsWith("-") && workspace === null) {
      workspace = a;
    }
  }

  return { workspace, transport, help };
}

/**
 * Resolve the effective workspace directory. Returns null when no workspace
 * could be located (no --workspace flag, no workspace.yaml in cwd, no
 * positional path).
 */
function resolveWorkspaceDir(workspaceArg: string | null): string | null {
  if (workspaceArg !== null) {
    const abs = path.resolve(workspaceArg);
    return existsSync(abs) ? abs : null;
  }
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "workspace.yaml"))) return cwd;
  return null;
}

/**
 * Print help. Uses Phase-1 vocabulary like every other command.
 */
function printHelp(): void {
  console.log(`\n${BLD}${tr("cli.command.mcp")}${R}\n`);
  console.log(`  ${tr("cli.help.mcp.workspace")}`);
  console.log(`  ${tr("cli.help.mcp.transport")}\n`);
}

/**
 * Run the `chemag mcp` command. Returns the exit code synchronously by
 * synchronously starting the async work and exiting via process.exit when
 * the server settles. This matches the existing command shape — process.exit
 * inside the function for error paths, return 0 to let the dispatcher fall
 * through on success.
 */
export function cmdMcp(argv: string[]): number {
  const args = parseMcpArgs(argv);

  if (args.help) {
    printHelp();
    return 0;
  }

  // Validate transport up front — `sse` is reserved for v1.0.x.
  if (args.transport !== "stdio") {
    console.error(
      `${RED}error${R} CHEM-MCP-002 ${tr("diagnostic.mcp_transport_unsupported", {
        transport: args.transport,
      })}`,
    );
    return 2;
  }

  const workspaceDir = resolveWorkspaceDir(args.workspace);
  if (workspaceDir === null) {
    console.error(`${RED}error${R} CHEM-MCP-001 ${tr("diagnostic.mcp_workspace_required")}`);
    return 2;
  }

  // Boot the server asynchronously. The async IIFE pattern keeps cmdMcp's
  // signature `(argv) => number` while awaiting the SDK's async transport
  // lifecycle. Errors after this point exit via process.exit so the dispatch
  // doesn't fall through to a stale 0.
  void runMcpServer(workspaceDir, args.transport).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${RED}error${R} ${tr("diagnostic.mcp_initialize_failed", { reason: msg })}`);
    process.exit(2);
  });

  return 0;
}

async function runMcpServer(workspaceDir: string, transport: "stdio"): Promise<void> {
  // Dynamic import keeps the CLI start-up cost low for users who never
  // invoke `chemag mcp`. The static workspace dep ensures the resolution
  // always succeeds in published bundles.
  const { createServer, createTransport } = await import("@chemag/mcp-server");
  const handle = createServer({ workspaceUri: workspaceDir });
  const t = createTransport(transport);

  // Bridge transport close into a clean exit. The SDK handles JSON-RPC
  // shutdown semantics; we just clean up the session afterwards.
  let shuttingDown = false;
  const onTransportClose = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await handle.dispose();
    process.exit(0);
  };

  await handle.connect(t);

  // Wire the SDK's transport.onclose for explicit close() calls...
  const transportWithClose = t as { onclose?: () => void };
  const prev = transportWithClose.onclose;
  transportWithClose.onclose = (): void => {
    prev?.();
    void onTransportClose();
  };

  // ...and listen for stdin EOF, since the StdioServerTransport doesn't
  // surface end-of-stream itself. The canonical Unix shutdown signal for
  // an MCP stdio server is the client closing stdin, so we need to react
  // to it explicitly.
  if (transport === "stdio") {
    process.stdin.once("end", () => {
      void onTransportClose();
    });
    process.stdin.once("close", () => {
      void onTransportClose();
    });
  }

  const onSignal = (): void => {
    void onTransportClose();
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
}
