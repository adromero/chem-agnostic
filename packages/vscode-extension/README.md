# chemag — VS Code extension (v0.2)

Surfaces chemag architecture diagnostics inline (via an embedded Language
Server), shows the active file's compound/role in the status bar, and brokers
an MCP connection to the `chemag mcp` subprocess for AI-assisted UX.

v0.2 introduces an LSP-based architecture: diagnostics and quick-fix code
actions are produced by a standalone Node process bundled at
`server/dist/server.js`. The VS Code extension is a thin LSP client; other
LSP-capable editors (Zed, Helix, Neovim) can spawn the same server directly
(see "Using the LSP server from non-VS Code editors" below).

The following surfaces remain deliberately deferred to follow-up work:

- Architecture sidebar tree view
- First-run walkthrough + media assets
- `chemag: Add compound`, `chemag: Add unit`, `chemag: Where should this go?`,
  `chemag: Install hooks` commands
- Rich Mermaid webview rendering (v0.2 still dumps the Mermaid source into an
  untitled markdown document)
- VS Code Marketplace publishing
- The `chemag lsp` CLI command (deferred to v0.3 — until then, spawn the
  server module directly as documented below)

## Commands

- `chemag: Check workspace` — runs `chemag check workspace.yaml` (full
  workspace scan, output streamed to the `chemag` output channel) AND pings
  the LSP server with `chemag/forceCheck` for the active editor's file (so a
  fresh per-file diagnostics pass shows up in the Problems panel even when
  `chemag.runOn === "manual"`).
- `chemag: Show graph` — runs `chemag graph workspace.yaml` and opens the
  resulting Mermaid source in a new untitled markdown document.

## Settings

- `chemag.cli.path` — Path to the `chemag` CLI. Empty = auto-detect from `PATH`.
- `chemag.vocabulary` — `standard` (default) | `chemistry`. Vocabulary used for
  diagnostic messages.
- `chemag.runOn` — `save` (default) | `type` | `manual`. Controls when the
  LSP server publishes diagnostics. **Preserved unchanged from v0.1**: the
  setting is forwarded to the server via LSP `initializationOptions.runOn`,
  and live edits are forwarded via `workspace/didChangeConfiguration` so the
  mode can change without restarting the server. Behaviour:
  - `save` — diagnostics only on document save.
  - `type` — debounced 800ms after each edit (also on save).
  - `manual` — never auto-publish; use the `chemag: Check workspace` command
    (which sends a `chemag/forceCheck` request to the server) to refresh.

## Diagnostics

The bundled LSP server runs `@chemag/core`'s `runCheckEdit` engine on the
active document and publishes the resulting diagnostics through the LSP
`textDocument/publishDiagnostics` channel. Diagnostic codes follow the
canonical `CHEM-CATEGORY-NNN` format defined in
`packages/core/schemas/check-edit-result.schema.json`.

## Quick-fix code actions

The server's `textDocument/codeAction` handler maps the five remediation
kinds defined by the check-edit schema to LSP `CodeAction[]` (kind:
`QuickFix`):

| Remediation kind | Action |
|---|---|
| `use_interface` | Suggest each interface candidate; rewrite the import specifier on accept. |
| `move_to_compound` | Offer each compound candidate; emit a workspace `rename` edit moving the file under the chosen compound's role folder. |
| `move_to_role_folder` | Move the file under the current compound into the expected role folder. |
| `import_via_public_surface` | Rewrite the offending import to go through the target compound's public surface. |
| `add_compound_import` | Insert a top-level marker comment for adding the missing compound import. |

## Using the LSP server from non-VS Code editors

The LSP server is a self-contained CommonJS Node module bundled into the
chemag-vscode npm package. Plugin authors targeting Zed, Helix, Neovim or
JetBrains can spawn it directly over stdio:

```bash
node node_modules/chemag-vscode/server/dist/server.js --stdio
```

The server reads its initial mode from the LSP `initializationOptions`:

```jsonc
{
  "initializationOptions": { "runOn": "save" }  // "save" | "type" | "manual"
}
```

…and accepts live updates via `workspace/didChangeConfiguration`:

```jsonc
{ "settings": { "chemag": { "runOn": "type" } } }
```

The custom `chemag/forceCheck` request publishes diagnostics for a single URI
regardless of the current mode:

```jsonc
{ "method": "chemag/forceCheck", "params": { "uri": "file:///path/to/file.ts" } }
```

A future `chemag lsp` CLI subcommand (v0.3) will re-export the same module
through the main `chemag` binary so plugin authors don't have to know the
extension's npm-package internal layout.
