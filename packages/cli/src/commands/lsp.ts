// ---------------------------------------------------------------------------
// `chemag lsp [--help]`
//
// Boots the chemag Language Server Protocol server in this process and binds
// it to stdio. The server discovers the workspace root from the LSP
// `initialize` request (`workspaceFolders` -> `rootUri` -> `rootPath`), so
// this command takes no positional arguments today.
//
// Mirrors the shape of `cmdMcp` in `./mcp.ts`: synchronous return code,
// async server lifecycle managed via an inline IIFE, exits via process.exit
// on transport close. The static `package.json` dependency on
// `@chemag/lsp-server` keeps Turbo's `^build` ordering honest; the dynamic
// import keeps the CLI's cold-start cost low for users who never invoke
// `chemag lsp`.
//
// The server runs over stdio: any LSP-capable editor (VS Code via the
// `chemag-vscode` extension, Zed, Helix, Neovim, ...) can attach by
// spawning `chemag lsp` and speaking LSP framed JSON-RPC on stdin/stdout.
// ---------------------------------------------------------------------------

const R = "\x1b[0m";
const RED = "\x1b[31m";
const BLD = "\x1b[1m";

interface ParsedArgs {
  help: boolean;
}

/**
 * Parse the `chemag lsp` argv. Recognized flags:
 *   --help / -h          help
 *
 * Any other tokens are silently ignored — the server inherits its workspace
 * from the LSP `initialize` request, not from CLI argv, so leftover
 * positionals never carry meaning here.
 */
export function parseLspArgs(argv: string[]): ParsedArgs {
  let help = false;
  for (const a of argv) {
    if (a === "--help" || a === "-h") {
      help = true;
    }
  }
  return { help };
}

function printHelp(): void {
  console.log(`\n${BLD}lsp${R} — run a Language Server Protocol server for chemag.`);
  console.log("");
  console.log("Boots the chemag LSP server over stdio. Any LSP-capable editor (Zed, Helix,");
  console.log("Neovim, Sublime, ...) can attach by spawning `chemag lsp` and speaking LSP-");
  console.log("framed JSON-RPC on the child's stdin/stdout.");
  console.log("");
  console.log(`${BLD}USAGE:${R} chemag lsp [--help]`);
  console.log("");
  console.log("The workspace root is discovered from the LSP `initialize` request — there");
  console.log("is no --workspace flag. See `chemag mcp` for the equivalent stdio command");
  console.log("for MCP-aware clients.");
  console.log("");
}

/**
 * Run the `chemag lsp` command. Returns 0 on a clean help/print path; the
 * stdio server otherwise runs until its transport closes (client EOF /
 * SIGTERM / SIGINT) and exits via process.exit so the dispatcher does NOT
 * fall through to a stale 0.
 */
export function cmdLsp(argv: string[]): number {
  const args = parseLspArgs(argv);

  if (args.help) {
    printHelp();
    return 0;
  }

  void runLspServer().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${RED}error${R} chemag lsp failed to start: ${msg}`);
    process.exit(2);
  });

  return 0;
}

async function runLspServer(): Promise<void> {
  // Dynamic import keeps cold-start cost low for users who never invoke
  // `chemag lsp`. The static workspace dep on `@chemag/lsp-server` ensures
  // resolution always succeeds in published bundles.
  const mod = (await import("@chemag/lsp-server")) as { runServer: () => unknown };
  if (typeof mod.runServer !== "function") {
    throw new Error("@chemag/lsp-server is missing the `runServer` export");
  }

  // runServer() with no opts attaches to stdio via vscode-languageserver's
  // default `createConnection(ProposedFeatures.all)` path. The connection
  // owns the lifecycle from here; we only need to bridge stdin EOF and
  // POSIX signals into a clean process.exit so the parent shell sees a
  // graceful close (mirroring the convention from `chemag mcp`).
  mod.runServer();

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exit(0);
  };

  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
