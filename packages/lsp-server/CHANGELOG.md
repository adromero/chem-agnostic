# @chemag/lsp-server

## 0.3.0

### Minor Changes

- 7046495: WP-027b — Standalone `chemag lsp` CLI command + new `@chemag/lsp-server` workspace package.

  The Language Server Protocol implementation that previously lived as a private sub-package inside the `chemag-vscode` extension (`packages/vscode-extension/server/`) has been promoted to a top-level publishable package, `@chemag/lsp-server`. Both the VS Code extension and the new `chemag lsp` CLI subcommand now depend on it via `workspace:*`, and any LSP-capable editor (Zed, Helix, Neovim, Sublime LSP, ...) can spawn the server via `chemag lsp`.

  Changes:

  - **New package `@chemag/lsp-server`**: ships the same wp-027 server (9 protocol tests preserved) with a public barrel exporting `runServer` (alias for `startServer`), `WorkspaceState`, `runDiagnostics`, `buildCodeActions`, etc. for embedders.
  - **New `@chemag/cli` subcommand `chemag lsp`**: boots the server in-process over stdio. Workspace root is discovered from the LSP `initialize` request — no `--workspace` flag needed. Lists under `Integrations` in `chemag --help`.
  - **VS Code extension** now spawns `dist/server.js` (the .vsix-bundled, parallel-esbuild output) instead of `server/dist/server.js` (the old sub-package path). Both `dist/extension.js` and `dist/server.js` stay under the 1 MB budget the .vsix size criterion enforces.
  - **No turbo.json change required**: the new workspace deps on `@chemag/lsp-server` from both `@chemag/cli` and `chemag-vscode` plug into Turbo's existing `^build` ordering rule.

  See `packages/lsp-server/README.md` for editor-configuration examples.
