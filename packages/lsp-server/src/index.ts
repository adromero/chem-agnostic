// ---------------------------------------------------------------------------
// @chemag/lsp-server — public barrel.
//
// Consumers (the chemag-vscode extension, the `chemag lsp` CLI subcommand,
// and any third-party Zed/Helix/Neovim plugin) import from this module to
// boot the LSP server in-process or to introspect the helpers used by the
// internal protocol tests.
//
// The server itself is implemented in `./server.ts` and is bundled by
// `scripts/build.js` (esbuild, self-contained CJS) into `dist/server.js`
// so that it can be spawned as a child process from inside the .vsix
// sandbox where no other node_modules are reachable.
// ---------------------------------------------------------------------------

export {
  startServer,
  runServer,
  resolveWorkspaceDir,
  extractRunOnFromConfigChange,
  uriToPath,
  TYPE_DEBOUNCE_MS,
  type ServerHandle,
  type StartServerOptions,
} from "./server.js";

export {
  buildCodeActions,
  type CodeActionContext,
} from "./code-actions.js";

export { runDiagnostics, pathToUri, type CheckEditOutcome } from "./diagnostics.js";

export {
  WorkspaceState,
  coerceRunOn,
  DEFAULT_RUN_ON,
  type RunOnMode,
  type WorkspaceStateOptions,
} from "./workspace-state.js";
