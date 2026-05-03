// ---------------------------------------------------------------------------
// `chemag.showGraph` command — runs `chemag graph workspace.yaml` and opens
// the resulting Mermaid source in a new untitled markdown document, fenced
// with ```mermaid so users can preview it via the markdown preview pane.
//
// Rich webview-rendered Mermaid is deferred to a follow-up stage.
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import * as path from "node:path";
import { execFile } from "node:child_process";

export interface ShowGraphOptions {
  cliPath: string;
  workspaceDir: string;
  output: vscode.OutputChannel;
}

export function makeShowGraphCommand(opts: ShowGraphOptions): () => Promise<void> {
  return async (): Promise<void> => {
    const wsPath = path.join(opts.workspaceDir, "workspace.yaml");
    opts.output.appendLine(`[graph] $ ${opts.cliPath} graph ${wsPath}`);

    const result = await runCli(opts.cliPath, ["graph", wsPath], opts.workspaceDir);
    if (result.exitCode !== 0) {
      opts.output.appendLine(result.stderr);
      void vscode.window.showErrorMessage(
        `chemag: graph failed (exit ${result.exitCode}). See the chemag output channel for details.`,
      );
      return;
    }

    const mermaid = result.stdout.trimEnd();
    const body = `# chemag graph\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n`;
    const doc = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: body,
    });
    await vscode.window.showTextDocument(doc, { preview: false });
  };
}

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCli(cli: string, args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      cli,
      args,
      { cwd, env: process.env, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // execFile sets err with `code` on non-zero exit; we don't reject
        // because the caller wants stdout/stderr regardless.
        let exitCode = 0;
        if (err) {
          const codeField = (err as NodeJS.ErrnoException & { code?: number | string }).code;
          if (typeof codeField === "number") exitCode = codeField;
          else exitCode = 1;
        }
        resolve({ exitCode, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}
