// ---------------------------------------------------------------------------
// chemag LSP server — entry point.
//
// Exposes:
//   - textDocument/didOpen, didChange, didSave, didClose
//   - textDocument/codeAction (QuickFix; sourced from check-edit remediations)
//   - workspace/didChangeConfiguration  (refreshes the runOn mode)
//   - workspace/didChangeWatchedFiles   (invalidates manifest cache)
//   - chemag/forceCheck                 (custom request — used by the VS Code
//                                        extension's "Check workspace" command
//                                        when runOn === "manual")
//
// Capabilities advertised:
//   * textDocumentSync: Incremental
//   * codeActionProvider: { codeActionKinds: [QuickFix] }
//
// runOn modes (from `initializationOptions.runOn`):
//   "save"   — diagnostics published on didSave only
//   "type"   — diagnostics debounced 800ms after didChange (also on didSave)
//   "manual" — neither didChange nor didSave publish; only chemag/forceCheck
//
// The server is structured so it can be exported (`startServer`) and unit-
// tested with vscode-jsonrpc message-stream pairs (see test/server.test.ts).
// ---------------------------------------------------------------------------

import {
  Connection,
  CodeActionKind,
  Diagnostic as LspDiagnostic,
  DidChangeConfigurationNotification,
  ProposedFeatures,
  TextDocumentSyncKind,
  createConnection,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocuments } from "vscode-languageserver/node";
import * as path from "node:path";
import * as url from "node:url";

import { runDiagnostics, uriToPath } from "./diagnostics.js";
import { buildCodeActions } from "./code-actions.js";
import { coerceRunOn, DEFAULT_RUN_ON, WorkspaceState, type RunOnMode } from "./workspace-state.js";
import type { CheckEditDiagnostic } from "@chemag/core";

export const TYPE_DEBOUNCE_MS = 800;

// ---------------------------------------------------------------------------
// Config message helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Extract `chemag.runOn` from a `workspace/didChangeConfiguration` payload.
 * Accepts both shapes the protocol uses:
 *   - `{ settings: { chemag: { runOn: "type" } } }`
 *   - `{ settings: { runOn: "type" } }` (already namespaced by the client)
 */
export function extractRunOnFromConfigChange(params: unknown): RunOnMode | null {
  if (!params || typeof params !== "object") return null;
  const settings = (params as { settings?: unknown }).settings;
  if (!settings || typeof settings !== "object") return null;
  const flat = (settings as { runOn?: unknown }).runOn;
  if (flat !== undefined) return coerceRunOn(flat);
  const ns = (settings as { chemag?: { runOn?: unknown } }).chemag;
  if (ns && typeof ns === "object" && "runOn" in ns) return coerceRunOn(ns.runOn);
  return null;
}

/**
 * Resolve the workspace root from the LSP `initialize` params. Honours the
 * post-3.6 `workspaceFolders` first, then `rootUri`, then the legacy
 * `rootPath`. Returns `process.cwd()` as the last resort so the server can
 * still come up against a vacuous client.
 */
export function resolveWorkspaceDir(initParams: {
  workspaceFolders?: { uri: string }[] | null;
  rootUri?: string | null;
  rootPath?: string | null;
}): string {
  const folders = initParams.workspaceFolders;
  if (folders && folders.length > 0) {
    return url.fileURLToPath(folders[0].uri);
  }
  if (initParams.rootUri) return url.fileURLToPath(initParams.rootUri);
  if (initParams.rootPath) return path.resolve(initParams.rootPath);
  return process.cwd();
}

// ---------------------------------------------------------------------------
// startServer — bootstraps a connection. Default export expects stdio when
// process.argv contains --stdio; tests pass an explicit Connection.
// ---------------------------------------------------------------------------

export interface StartServerOptions {
  /** Pre-built connection (used by tests). When omitted, stdio is chosen. */
  connection?: Connection;
  /**
   * Override the debounce timer for didChange. Tests pass a small/zero value
   * to avoid sleeping; defaults to TYPE_DEBOUNCE_MS.
   */
  debounceMs?: number;
}

export interface ServerHandle {
  connection: Connection;
  /** Currently-resolved workspace state (null until `initialize` completes). */
  state(): WorkspaceState | null;
  /** Currently-resolved runOn mode (null until `initialize` completes). */
  runOn(): RunOnMode | null;
  /** Force a check of the file at `uri` and publish its diagnostics. */
  forceCheck(uri: string): void;
}

export function startServer(opts: StartServerOptions = {}): ServerHandle {
  const debounceMs = opts.debounceMs ?? TYPE_DEBOUNCE_MS;
  const connection: Connection = opts.connection ?? createConnection(ProposedFeatures.all);
  const documents = new TextDocuments(TextDocument);

  let state: WorkspaceState | null = null;
  // Cache of last-run raw diagnostics per URI — used by the code-action
  // handler to map LSP diagnostics back to remediations without re-running
  // the engine. Cleared on every fresh check.
  const lastRawByUri = new Map<string, CheckEditDiagnostic[]>();
  const debounceTimers = new Map<string, NodeJS.Timeout>();

  // -------------------------------------------------------------------------
  // initialize / initialized
  // -------------------------------------------------------------------------

  connection.onInitialize((params) => {
    const workspaceDir = resolveWorkspaceDir({
      workspaceFolders: params.workspaceFolders ?? null,
      rootUri: params.rootUri ?? null,
      rootPath: (params as { rootPath?: string | null }).rootPath ?? null,
    });
    const initOpts = params.initializationOptions as { runOn?: unknown } | undefined;
    const runOn = coerceRunOn(initOpts?.runOn);
    state = new WorkspaceState({ workspaceDir, runOn });

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        codeActionProvider: {
          codeActionKinds: [CodeActionKind.QuickFix],
        },
      },
    };
  });

  connection.onInitialized(() => {
    // Try to register dynamic config-change subscription. If the client
    // doesn't support dynamic registration this is a no-op.
    void connection.client
      .register(DidChangeConfigurationNotification.type, undefined)
      .catch(() => {
        // Best-effort; older clients send didChangeConfiguration anyway.
      });
  });

  // -------------------------------------------------------------------------
  // Configuration changes — re-apply the runOn mode without restart.
  // -------------------------------------------------------------------------

  connection.onDidChangeConfiguration((params) => {
    if (!state) return;
    const next = extractRunOnFromConfigChange(params);
    if (next) state.setRunOn(next);
  });

  // -------------------------------------------------------------------------
  // Watched-file changes — invalidate manifest caches.
  // -------------------------------------------------------------------------

  connection.onDidChangeWatchedFiles(() => {
    if (state) state.invalidate();
  });

  // -------------------------------------------------------------------------
  // textDocument lifecycle
  // -------------------------------------------------------------------------

  documents.onDidSave((event) => {
    if (!state) return;
    const mode = state.runOn;
    if (mode === "manual") return;
    // For both "save" and "type", didSave triggers an immediate check.
    runAndPublish(event.document.uri, event.document.getText());
  });

  documents.onDidChangeContent((event) => {
    if (!state) return;
    const mode = state.runOn;
    if (mode !== "type") return;
    // Debounce: cancel any pending timer for this URI and schedule a fresh
    // check. The timer fires at debounceMs (or whatever the caller passed
    // in via StartServerOptions.debounceMs).
    const uri = event.document.uri;
    const existing = debounceTimers.get(uri);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceTimers.delete(uri);
      const doc = documents.get(uri);
      runAndPublish(uri, doc?.getText());
    }, debounceMs);
    debounceTimers.set(uri, timer);
  });

  documents.onDidClose((event) => {
    // Drop any cached state for the closed document.
    lastRawByUri.delete(event.document.uri);
    const t = debounceTimers.get(event.document.uri);
    if (t) {
      clearTimeout(t);
      debounceTimers.delete(event.document.uri);
    }
    // Also clear published diagnostics so the file's row in the Problems
    // panel disappears once it's no longer open.
    void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  });

  // -------------------------------------------------------------------------
  // Custom request: chemag/forceCheck — publishes diagnostics regardless of
  // the runOn mode. Used by the VS Code extension's "Check workspace"
  // command in `runOn: "manual"` mode (and as a manual-refresh hook for
  // any LSP client).
  // -------------------------------------------------------------------------

  connection.onRequest("chemag/forceCheck", (params: { uri?: string }) => {
    if (!state) return { ok: false, reason: "not initialized" };
    const uri = params?.uri;
    if (!uri) return { ok: false, reason: "missing uri" };
    const doc = documents.get(uri);
    runAndPublish(uri, doc?.getText());
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // textDocument/codeAction
  // -------------------------------------------------------------------------

  connection.onCodeAction((params) => {
    if (!state) return [];
    const uri = params.textDocument.uri;
    const raw = lastRawByUri.get(uri);
    if (!raw || raw.length === 0) return [];
    return buildCodeActions({
      state,
      uri,
      contextDiagnostics: params.context.diagnostics ?? [],
      rawDiagnostics: raw,
    });
  });

  // -------------------------------------------------------------------------
  // Internal helper — run check-edit + publish diagnostics + cache raw rows
  // for the code-action handler.
  // -------------------------------------------------------------------------

  function runAndPublish(uri: string, content: string | undefined): void {
    if (!state) return;
    const outcome = runDiagnostics(state, uri, content);
    lastRawByUri.set(uri, outcome.raw);
    for (const [targetUri, diags] of outcome.byFile) {
      void connection.sendDiagnostics({ uri: targetUri, diagnostics: diags as LspDiagnostic[] });
    }
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  documents.listen(connection);
  connection.listen();

  return {
    connection,
    state: () => state,
    runOn: () => state?.runOn ?? null,
    forceCheck: (uri: string) => {
      if (!state) return;
      const doc = documents.get(uri);
      runAndPublish(uri, doc?.getText());
    },
  };
}

// When invoked directly (the bundle's main module), boot a stdio server.
if (require.main === module) {
  startServer();
}

// Re-export utilities used by tests.
export { uriToPath };
