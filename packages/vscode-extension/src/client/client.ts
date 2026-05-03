// ---------------------------------------------------------------------------
// chemag LSP client — spawns the bundled LSP server (server/dist/server.js)
// as a Node child process and relays text-document events.
//
// Configuration:
//   - `chemag.runOn` is read from VS Code settings and forwarded to the
//     server via `initializationOptions.runOn` (resolved to "save" | "type" |
//     "manual"; default "save"). Subsequent changes to the setting are
//     forwarded via `workspace/didChangeConfiguration` so the server can
//     update its mode without a restart.
//
// File location note: this module lives under `src/client/` (NOT a parallel
// top-level `client/` directory) so it falls under the parent extension's
// existing `tsconfig.json` `include: ["src/**/*.ts"]` and is naturally
// covered by `pnpm --filter chemag-vscode typecheck`.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import * as fs from "node:fs";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

const CLIENT_ID = "chemag";
const CLIENT_NAME = "chemag";

export type RunOnMode = "save" | "type" | "manual";

export interface ChemagLspClientOptions {
  /** Absolute path to the chemag-vscode extension's installation directory. */
  extensionPath: string;
  /** Workspace root directory (containing workspace.yaml). */
  workspaceDir: string;
  /** Output channel for client-side telemetry. */
  output: vscode.OutputChannel;
}

export class ChemagLspClient implements vscode.Disposable {
  private client: LanguageClient | null = null;
  private subs: vscode.Disposable[] = [];

  constructor(private readonly opts: ChemagLspClientOptions) {}

  /**
   * Boot the LSP client + server. Resolves once `client.start()` returns
   * (the client's connection is up; the server has acknowledged
   * `initialize`).
   *
   * Throws if the bundled server module is not present at the expected
   * path — this should only happen during local development before the
   * server has been built.
   */
  async start(): Promise<void> {
    const serverModule = path.join(this.opts.extensionPath, "server", "dist", "server.js");
    if (!fs.existsSync(serverModule)) {
      throw new Error(
        `chemag LSP server bundle not found at ${serverModule}. Run \`pnpm --filter chemag-vscode-lsp-server build\` to produce it.`,
      );
    }

    const serverOptions: ServerOptions = {
      run: { module: serverModule, transport: TransportKind.stdio },
      debug: {
        module: serverModule,
        transport: TransportKind.stdio,
        options: { execArgv: ["--nolazy", "--inspect=6049"] },
      },
    };

    const initialRunOn = readRunOn();
    const documentSelector = await buildDocumentSelector(this.opts.workspaceDir);

    const clientOptions: LanguageClientOptions = {
      documentSelector,
      synchronize: {
        // Watch workspace.yaml + every compound.yaml so the server can drop
        // its in-memory caches when manifests change.
        fileEvents: [
          vscode.workspace.createFileSystemWatcher("**/workspace.yaml"),
          vscode.workspace.createFileSystemWatcher("**/compound.yaml"),
        ],
      },
      initializationOptions: { runOn: initialRunOn },
      outputChannel: this.opts.output,
      workspaceFolder: vscode.workspace.workspaceFolders?.[0],
    };

    this.client = new LanguageClient(CLIENT_ID, CLIENT_NAME, serverOptions, clientOptions);
    await this.client.start();
    this.opts.output.appendLine(`[lsp] client started — runOn=${initialRunOn}`);

    // Forward chemag.runOn config changes to the server without restarting.
    this.subs.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("chemag.runOn")) return;
        const next = readRunOn();
        // Use both shapes the server's extractRunOnFromConfigChange accepts.
        this.client
          ?.sendNotification("workspace/didChangeConfiguration", {
            settings: { chemag: { runOn: next } },
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.opts.output.appendLine(`[lsp] config-change forward failed: ${msg}`);
          });
        this.opts.output.appendLine(`[lsp] runOn → ${next}`);
      }),
    );
  }

  /**
   * Send the custom `chemag/forceCheck` request to the server. Used by the
   * `chemag.checkWorkspace` command so it works even when `runOn === "manual"`.
   */
  async forceCheck(uri: vscode.Uri): Promise<unknown> {
    if (!this.client) throw new Error("chemag LSP client is not started");
    return this.client.sendRequest("chemag/forceCheck", { uri: uri.toString() });
  }

  /** True once `start()` has resolved and the underlying client is running. */
  isRunning(): boolean {
    return this.client?.isRunning() ?? false;
  }

  async dispose(): Promise<void> {
    for (const sub of this.subs) sub.dispose();
    this.subs = [];
    const c = this.client;
    this.client = null;
    if (c) {
      try {
        await c.stop();
      } catch {
        // best-effort
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readRunOn(): RunOnMode {
  const cfg = vscode.workspace.getConfiguration("chemag");
  const raw = cfg.get<string>("runOn", "save");
  if (raw === "save" || raw === "type" || raw === "manual") return raw;
  return "save";
}

/**
 * Build the LSP `documentSelector`. We always include workspace.yaml and
 * compound.yaml; we add language-specific globs when the workspace.yaml
 * declares a `language:` field. Falling back to a permissive selector
 * (TS/JS/Python/Go) ensures the client still activates if we can't read
 * the manifest yet.
 */
async function buildDocumentSelector(
  workspaceDir: string,
): Promise<LanguageClientOptions["documentSelector"]> {
  const baseSelectors: LanguageClientOptions["documentSelector"] = [
    { scheme: "file", pattern: "**/workspace.yaml" },
    { scheme: "file", pattern: "**/compound.yaml" },
  ];

  // Best-effort: try to read the workspace's language hint and add an
  // appropriate language-id selector. On failure we add a broad fallback.
  try {
    const wsPath = path.join(workspaceDir, "workspace.yaml");
    if (!fs.existsSync(wsPath)) return [...baseSelectors, ...broadFallback()];
    const content = await fs.promises.readFile(wsPath, "utf8");
    const match = content.match(/^\s*language\s*:\s*([a-zA-Z0-9_-]+)/m);
    const lang = match?.[1]?.toLowerCase();
    if (lang === "typescript") {
      return [
        ...baseSelectors,
        { scheme: "file", language: "typescript" },
        { scheme: "file", language: "typescriptreact" },
      ];
    }
    if (lang === "python") {
      return [...baseSelectors, { scheme: "file", language: "python" }];
    }
    if (lang === "go") {
      return [...baseSelectors, { scheme: "file", language: "go" }];
    }
    return [...baseSelectors, ...broadFallback()];
  } catch {
    return [...baseSelectors, ...broadFallback()];
  }
}

function broadFallback(): { scheme: string; language: string }[] {
  return [
    { scheme: "file", language: "typescript" },
    { scheme: "file", language: "typescriptreact" },
    { scheme: "file", language: "javascript" },
    { scheme: "file", language: "javascriptreact" },
    { scheme: "file", language: "python" },
    { scheme: "file", language: "go" },
  ];
}
