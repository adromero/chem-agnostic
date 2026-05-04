// ---------------------------------------------------------------------------
// `chemag.installHooks` command — pick an AI editor and run
// `chemag install-hooks --tool <tool>`, streaming output into the chemag
// OutputChannel.
//
// V0 picker scope: single tools only. The CLI also supports `all` (fan-out
// across every tool) but we deliberately omit it from the picker — guiding
// the user through one tool at a time keeps the v0 surface focused.
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import { spawn } from "node:child_process";

export interface InstallHooksOptions {
  cliPath: string;
  workspaceDir: string;
  output: vscode.OutputChannel;
}

const TOOL_CHOICES = ["claude", "cursor", "codex", "aider", "cline", "copilot"] as const;

export function makeInstallHooksCommand(opts: InstallHooksOptions): () => Promise<void> {
  return async (): Promise<void> => {
    const tool = await vscode.window.showQuickPick([...TOOL_CHOICES], {
      placeHolder: "Tool to install hooks for",
    });
    if (tool === undefined) return; // user cancelled — silent no-op

    opts.output.show(true);
    opts.output.appendLine(`[install-hooks] $ ${opts.cliPath} install-hooks --tool ${tool}`);

    const child = spawn(opts.cliPath, ["install-hooks", "--tool", tool], {
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
      opts.output.appendLine(`[install-hooks] spawn error: ${err.message}`);
    });

    child.on("close", (code) => {
      opts.output.appendLine(`[install-hooks] exit ${code ?? "?"}`);
      if (code === 0) {
        void vscode.window.showInformationMessage(`chemag: hooks installed for ${tool}`);
      } else {
        void vscode.window.showWarningMessage(
          `chemag: install-hooks exited with code ${code ?? "?"}. See the chemag output channel for details.`,
        );
      }
    });
  };
}
