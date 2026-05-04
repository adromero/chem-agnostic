// ---------------------------------------------------------------------------
// `chemag.showGraph` command — runs `chemag graph workspace.yaml` and renders
// the resulting Mermaid source inside a `vscode.window.createWebviewPanel`.
//
// wp-026e: replaces the previous markdown-document dump with a real
// Mermaid-rendered webview. The webview loads `dist/mermaid.js` (the IIFE
// bundle produced by the third esbuild pass — see `esbuild.config.js`) via
// `webview.asWebviewUri`, with strict CSP (no remote sources, per-render
// nonce). HTML scaffolding lives in `../webviews/graph-html.ts`.
//
// `lastPanel` is exported so tests can assert the panel was created and
// inspect its HTML. It is reset to `undefined` on `panel.onDidDispose`.
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import * as path from "node:path";
import { execFile } from "node:child_process";

import { renderGraphHtml } from "../webviews/graph-html";

export interface ShowGraphOptions {
  cliPath: string;
  workspaceDir: string;
  output: vscode.OutputChannel;
  extensionUri: vscode.Uri;
}

/**
 * Module-level reference to the most-recently-created graph webview panel.
 * Tests import this to verify the command opened a panel and to inspect the
 * generated HTML. Reset to `undefined` when the panel is disposed.
 */
export let lastPanel: vscode.WebviewPanel | undefined;

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

    const mermaidSource = result.stdout.trimEnd();

    // If a previous panel is still alive, reveal it instead of creating a
    // duplicate. Re-render the HTML so the contents reflect the latest CLI
    // output (Acceptance Criteria: "Closing and reopening the panel re-runs
    // the CLI and re-renders the graph").
    const distUri = vscode.Uri.joinPath(opts.extensionUri, "dist");
    if (lastPanel) {
      try {
        lastPanel.reveal(undefined, true);
        const scriptUri = lastPanel.webview.asWebviewUri(
          vscode.Uri.joinPath(distUri, "mermaid.js"),
        );
        lastPanel.webview.html = renderGraphHtml({
          mermaidSource,
          mermaidScriptUri: scriptUri,
          cspSource: lastPanel.webview.cspSource,
        });
        return;
      } catch {
        // Panel may have been disposed between the dispose handler and here;
        // fall through to create a new one.
        lastPanel = undefined;
      }
    }

    const panel = vscode.window.createWebviewPanel(
      "chemag.graph",
      "chemag: Graph",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        // Restrict load origins to the extension's `dist/` directory; the
        // bundled `dist/mermaid.js` is the only resource the webview pulls.
        localResourceRoots: [distUri],
        retainContextWhenHidden: true,
      },
    );

    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(distUri, "mermaid.js"));
    panel.webview.html = renderGraphHtml({
      mermaidSource,
      mermaidScriptUri: scriptUri,
      cspSource: panel.webview.cspSource,
    });

    lastPanel = panel;
    panel.onDidDispose(() => {
      if (lastPanel === panel) {
        lastPanel = undefined;
      }
    });
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
