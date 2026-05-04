// ---------------------------------------------------------------------------
// `chemag.addCompound` command — prompt for a compound name then run
// `chemag add compound <name>`, streaming stdout/stderr into the chemag
// OutputChannel and surfacing a completion notification on exit.
//
// Mirrors the spawn + on-data + on-error + on-close shape from
// `check-workspace.ts`. Cancellation of the input prompt (showInputBox
// returning undefined) is a silent no-op — no notification, no spawn.
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import { spawn } from "node:child_process";

export interface AddCompoundOptions {
  cliPath: string;
  workspaceDir: string;
  output: vscode.OutputChannel;
}

export function makeAddCompoundCommand(opts: AddCompoundOptions): () => Promise<void> {
  return async (): Promise<void> => {
    const name = await vscode.window.showInputBox({
      prompt: "Compound name",
      placeHolder: "e.g. payments",
      validateInput: (value) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) return "Compound name is required";
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
          return "Compound name must be alphanumeric (with optional . _ - separators)";
        }
        return null;
      },
    });
    if (name === undefined) return; // user cancelled — silent no-op
    const trimmed = name.trim();

    opts.output.show(true);
    opts.output.appendLine(`[add compound] $ ${opts.cliPath} add compound ${trimmed}`);

    const child = spawn(opts.cliPath, ["add", "compound", trimmed], {
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
      opts.output.appendLine(`[add compound] spawn error: ${err.message}`);
    });

    child.on("close", (code) => {
      opts.output.appendLine(`[add compound] exit ${code ?? "?"}`);
      if (code === 0) {
        void vscode.window.showInformationMessage(`chemag: compound "${trimmed}" added`);
      } else {
        void vscode.window.showWarningMessage(
          `chemag: add compound exited with code ${code ?? "?"}. See the chemag output channel for details.`,
        );
      }
    });
  };
}
