# Changelog

## 0.2.2

### Patch Changes

- Updated dependencies [7046495]
  - @chemag/lsp-server@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [4ab7c84]
- Updated dependencies [4ab7c84]
- Updated dependencies [4ab7c84]
  - @chemag/core@0.2.0

## 0.1.0 — MVP

Initial v0.1 release. Implements the load-bearing surfaces only:

- **Diagnostics** — runs `chemag check` against the workspace and surfaces
  JSON diagnostics as `vscode.Diagnostic`s. Triggers on save (default) or
  type (debounced 800ms), gated by `chemag.runOn`.
- **Status bar** — shows `compound/role` for the active editor, or
  `chemag: outside workspace` when the file is not part of any compound.
- **MCP bridge** — spawns `chemag mcp` as a child process and connects via
  `StdioClientTransport`. Surfaces `whereShouldThisGo` / `validateEdit`
  helpers (no commands consume them in v0.1; wp-027 will).
- **Commands** — `chemag.checkWorkspace`, `chemag.showGraph`.
- **Settings** — `chemag.cli.path`, `chemag.vocabulary`, `chemag.runOn`.

Deferred to follow-up stages: code actions, tree view, walkthrough,
additional commands, rich Mermaid webview, Marketplace publishing.
