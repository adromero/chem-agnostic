> ## ⚠️ Deprecated
>
> This package is part of the original chemag framework experiment,
> which has been wound down. The three semantic rules from Track R
> now ship as [eslint-plugin-port-discipline](https://www.npmjs.com/package/eslint-plugin-port-discipline)
> — see the [top-level README](../../README.md) for the full story.
>
> This package is preserved as a historical artifact. It still
> builds and its existing tests pass, but no further development
> is planned.

---

<img src="media/icon.png" alt="chemag" width="96" align="right" />

# chemag — VS Code extension (v0.2)

Surfaces chemag architecture diagnostics inline (via an embedded Language
Server), shows the active file's compound/role in the status bar, and brokers
an MCP connection to the `chemag mcp` subprocess for AI-assisted UX.

## Getting started

After installing the extension, VS Code opens the **Get started with chemag**
walkthrough automatically on first run. You can re-open it any time from the
command palette: **Help: Welcome → chemag: Get started**, or via the deep
link [`command:workbench.action.openWalkthrough?["chemag.gettingStarted"]`](command:workbench.action.openWalkthrough?%5B%22chemag.gettingStarted%22%5D).

The walkthrough takes about two minutes and covers the chemag mental model
(compounds / units / bonds), how to open a workspace that the extension can
activate against, and how to run your first `chemag: Check workspace` pass.

v0.2 introduces an LSP-based architecture: diagnostics and quick-fix code
actions are produced by a standalone Node process. The server lives in the
`@chemag/lsp-server` workspace package; the .vsix bundles a parallel-esbuild
copy at `dist/server.js`. The VS Code extension is a thin LSP client; other
LSP-capable editors (Zed, Helix, Neovim) can spawn the same server directly
via the `chemag lsp` CLI subcommand (see "Using the LSP server from non-VS
Code editors" below).

The following surfaces remain deliberately deferred to follow-up work:

- VS Code Marketplace publishing

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

The LSP server is published as the standalone `@chemag/lsp-server` package and
is also exposed via the `chemag lsp` CLI subcommand. The recommended way for
Zed / Helix / Neovim plugin authors to spawn the server is:

```bash
chemag lsp
```

See [`packages/lsp-server/README.md`](https://github.com/adromero/chem-agnostic/blob/main/packages/lsp-server/README.md)
for editor configuration examples and the full `initializationOptions` /
`chemag/forceCheck` reference.

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
