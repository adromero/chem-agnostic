// ---------------------------------------------------------------------------
// chemag VS Code extension — entry point.
//
// Activation:
//   1. Resolve the `chemag` CLI path (config first, then PATH lookup).
//   2. Locate the workspace folder containing workspace.yaml.
//   3. Boot the LSP client (which spawns server/dist/server.js as a child
//      process and starts publishing diagnostics + code actions).
//   4. Wire status bar, MCP bridge, and the 2 commands.
//   5. Each subsystem registers its own disposables on context.subscriptions.
//
// wp-027: the diagnostics-provider was deprecated; diagnostics now flow
// through the LSP server. The `chemag.runOn` user setting is preserved by
// forwarding the value through `initializationOptions` and
// `workspace/didChangeConfiguration`.
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";

import { ChemagLspClient } from "./client/client";
import { StatusBarManager } from "./status-bar";
import { McpBridge } from "./mcp-bridge";
import { makeCheckWorkspaceCommand } from "./commands/check-workspace";
import { makeShowGraphCommand } from "./commands/show-graph";

const OUTPUT_CHANNEL_NAME = "chemag";

let outputChannel: vscode.OutputChannel | null = null;
let mcpBridge: McpBridge | null = null;
let lspClient: ChemagLspClient | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(outputChannel);

  const cliPath = resolveCliPath();
  if (!cliPath) {
    void vscode.window
      .showErrorMessage(
        "chemag: CLI not found. Install `chemag` on your PATH or set `chemag.cli.path` in settings.",
        "Open Settings",
      )
      .then((choice) => {
        if (choice === "Open Settings") {
          void vscode.commands.executeCommand("workbench.action.openSettings", "chemag.cli.path");
        }
      });
    // Still register the commands so the user can re-trigger after fixing.
    registerStubCommands(context);
    return;
  }

  const workspaceDir = locateWorkspaceDir();
  if (!workspaceDir) {
    outputChannel.appendLine(
      "[activate] no workspace.yaml found in any open folder — registering commands but skipping LSP/status-bar/MCP",
    );
    registerStubCommands(context);
    return;
  }

  outputChannel.appendLine(`[activate] cli=${cliPath} workspace=${workspaceDir}`);

  // LSP client — spawns server/dist/server.js, publishes diagnostics, serves
  // code actions. Failure here is non-fatal; the rest of the extension stays
  // functional and the user gets a warning.
  lspClient = new ChemagLspClient({
    extensionPath: context.extensionPath,
    workspaceDir,
    output: outputChannel,
  });
  context.subscriptions.push({
    dispose: () => {
      const c = lspClient;
      lspClient = null;
      if (c) void c.dispose();
    },
  });
  try {
    await lspClient.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[activate] LSP client failed to start: ${msg}`);
    void vscode.window.showWarningMessage(
      `chemag: LSP server failed to start. Diagnostics will be unavailable. (${msg})`,
    );
  }

  // Status bar — compound/role for the active editor.
  const statusBar = new StatusBarManager(workspaceDir);
  context.subscriptions.push(statusBar);

  // MCP bridge — spawn chemag mcp + connect via StdioClientTransport. Failure
  // here is non-fatal (the rest of the extension stays functional).
  mcpBridge = new McpBridge({ cliPath, workspaceDir, output: outputChannel });
  context.subscriptions.push({
    dispose: () => {
      const b = mcpBridge;
      mcpBridge = null;
      if (b) void b.dispose();
    },
  });
  mcpBridge.start().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel?.appendLine(`[activate] MCP bridge failed to start: ${msg}`);
  });

  // Commands.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "chemag.checkWorkspace",
      makeCheckWorkspaceCommand({
        cliPath,
        workspaceDir,
        output: outputChannel,
        getLspClient: () => lspClient,
      }),
    ),
    vscode.commands.registerCommand(
      "chemag.showGraph",
      makeShowGraphCommand({ cliPath, workspaceDir, output: outputChannel }),
    ),
  );
}

export async function deactivate(): Promise<void> {
  // Most disposables run via context.subscriptions; the LSP client + MCP
  // bridge are async and benefit from explicit awaits.
  const c = lspClient;
  lspClient = null;
  if (c) {
    try {
      await c.dispose();
    } catch {
      // best-effort
    }
  }

  const b = mcpBridge;
  mcpBridge = null;
  if (b) {
    try {
      await b.dispose();
    } catch {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Register the two MVP commands as no-ops that surface a "CLI not found" or
 * "no workspace" message. Keeps the command IDs available so palette /
 * keybinding wiring doesn't error out and the activation test still passes.
 */
function registerStubCommands(context: vscode.ExtensionContext): void {
  const stub = (msg: string) => () => {
    void vscode.window.showWarningMessage(msg);
  };
  const noCli = "chemag: CLI not found. Install chemag on PATH or set chemag.cli.path.";
  const noWs = "chemag: no workspace.yaml found in the open folders.";

  context.subscriptions.push(
    vscode.commands.registerCommand("chemag.checkWorkspace", stub(resolveCliPath() ? noWs : noCli)),
    vscode.commands.registerCommand("chemag.showGraph", stub(resolveCliPath() ? noWs : noCli)),
  );
}

/**
 * Resolve the chemag CLI: explicit setting first, then PATH lookup via
 * `command -v` / `where`. Returns null when the binary cannot be found.
 */
function resolveCliPath(): string | null {
  const cfg = vscode.workspace.getConfiguration("chemag");
  const explicit = (cfg.get<string>("cli.path") ?? "").trim();
  if (explicit) {
    if (fs.existsSync(explicit)) return explicit;
    return null;
  }
  // Path-resolution: use `which` on POSIX, `where` on Windows.
  const isWin = process.platform === "win32";
  const probe = spawnSync(isWin ? "where" : "which", ["chemag"], {
    encoding: "utf8",
  });
  if (probe.status === 0) {
    const first = probe.stdout.split(/\r?\n/).find((l) => l.trim().length > 0);
    if (first) return first.trim();
  }
  return null;
}

/**
 * Locate the workspace folder containing a `workspace.yaml`. Returns the
 * first match (the activation event guarantees at least one exists when the
 * activate function is called via `workspaceContains`).
 */
function locateWorkspaceDir(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return null;
  for (const folder of folders) {
    const candidate = path.join(folder.uri.fsPath, "workspace.yaml");
    if (fs.existsSync(candidate)) return folder.uri.fsPath;
  }
  return null;
}
