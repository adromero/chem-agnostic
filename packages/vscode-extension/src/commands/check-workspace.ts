// ---------------------------------------------------------------------------
// `chemag.checkWorkspace` command — runs `chemag check workspace.yaml`,
// streams stdout/stderr into the chemag OutputChannel, and surfaces a
// completion notification with the exit code.
//
// wp-027: also pings the LSP server (when running) with the
// `chemag/forceCheck` custom request for the active editor's URI. This makes
// the command useful even when `chemag.runOn === "manual"` — it forces the
// server to publish a fresh diagnostics pass for the file the user is
// looking at, in addition to running the full workspace check via the CLI.
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { ChemagLspClient } from "../client/client";

export interface CheckWorkspaceOptions {
  cliPath: string;
  workspaceDir: string;
  output: vscode.OutputChannel;
  /**
   * Optional accessor that returns the live LSP client (or null when the
   * server isn't running). Lazy because `extension.ts` constructs the client
   * after the command factory is invoked.
   */
  getLspClient?: () => ChemagLspClient | null;
}

export function makeCheckWorkspaceCommand(opts: CheckWorkspaceOptions): () => void {
  return (): void => {
    const wsPath = path.join(opts.workspaceDir, "workspace.yaml");
    opts.output.show(true);
    opts.output.appendLine(`[check] $ ${opts.cliPath} check ${wsPath}`);

    // Best-effort: ask the LSP server to push a fresh diagnostics pass for
    // the active editor's file. This is what makes the command useful in
    // `runOn: "manual"` mode — the CLI pass below covers the whole workspace
    // (in the OutputChannel) while the LSP forceCheck targets the visible
    // file (in the Problems panel).
    const lsp = opts.getLspClient?.();
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (lsp?.isRunning() && activeUri) {
      lsp.forceCheck(activeUri).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        opts.output.appendLine(`[check] LSP forceCheck failed: ${msg}`);
      });
    }

    const child = spawn(opts.cliPath, ["check", wsPath], {
      cwd: opts.workspaceDir,
      env: process.env,
    });

    child.stdout.on("data", (chunk: Buffer) => {
      opts.output.append(chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      opts.output.append(chunk.toString("utf8"));
    });

    child.on("error", (err) => {
      void vscode.window.showErrorMessage(`chemag: failed to launch CLI: ${err.message}`);
      opts.output.appendLine(`[check] spawn error: ${err.message}`);
    });

    child.on("close", (code) => {
      opts.output.appendLine(`[check] exit ${code ?? "?"}`);
      if (code === 0) {
        void vscode.window.showInformationMessage("chemag: workspace check passed");
      } else {
        void vscode.window.showWarningMessage(
          `chemag: workspace check exited with code ${code ?? "?"}. See the chemag output channel for details.`,
        );
      }
    });
  };
}
