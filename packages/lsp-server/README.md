# @chemag/lsp-server

Language Server Protocol (LSP) server for [chemag](https://www.npmjs.com/package/@chemag/cli) — surfaces architecture diagnostics inline (bond violations, public-surface bypasses, role-folder mismatches, ...) and emits LSP `CodeAction[]` quick-fixes for every remediation produced by `@chemag/core`'s `runCheckEdit` engine.

The same server powers:

- the official VS Code extension (`chemag-vscode`), which spawns the bundled `dist/server.js` over stdio, and
- the standalone `chemag lsp` CLI subcommand from `@chemag/cli`, which boots the server in-process so any LSP-capable editor can attach.

This README is for **plugin authors** integrating chemag into Zed, Helix, Neovim, Sublime LSP, or any other editor that supports a stdio LSP server.

## Install

```sh
npm install -g @chemag/cli
```

## Spawning the server

The simplest path is to spawn the CLI:

```sh
chemag lsp
```

It boots the server over stdio in the current working directory. The workspace root is taken from the LSP `initialize` request (`workspaceFolders` → `rootUri` → `rootPath` → `cwd`).

If you prefer to spawn the bundled module directly (for example because you want to bypass the CLI's startup work), point your launcher at the bundle inside `node_modules`:

```sh
node "$(node -p "require.resolve('@chemag/lsp-server/dist/server.js')")"
```

The bundle is fully self-contained — it ships its own copy of `vscode-languageserver`, `@chemag/core`, and the language plugins.

## Editor configuration examples

### Neovim (with `nvim-lspconfig` 0.2+)

```lua
local configs = require("lspconfig.configs")
local lspconfig = require("lspconfig")

if not configs.chemag then
  configs.chemag = {
    default_config = {
      cmd = { "chemag", "lsp" },
      filetypes = { "yaml", "typescript", "typescriptreact", "python", "go" },
      root_dir = lspconfig.util.root_pattern("workspace.yaml"),
      single_file_support = false,
      init_options = { runOn = "save" },
    },
  }
end

lspconfig.chemag.setup({})
```

### Helix

`languages.toml`:

```toml
[language-server.chemag]
command = "chemag"
args = ["lsp"]

[language-server.chemag.config]
runOn = "save"

[[language]]
name = "yaml"
language-servers = ["chemag"]

[[language]]
name = "typescript"
language-servers = ["chemag", "typescript-language-server"]
```

### Zed

`~/.config/zed/settings.json`:

```jsonc
{
  "lsp": {
    "chemag": {
      "binary": { "path": "chemag", "arguments": ["lsp"] },
      "initialization_options": { "runOn": "save" }
    }
  },
  "languages": {
    "TypeScript": { "language_servers": ["chemag", "..."] },
    "Python": { "language_servers": ["chemag", "..."] }
  }
}
```

## `initializationOptions`

| Option  | Type                              | Default  | Description |
|---------|-----------------------------------|----------|-------------|
| `runOn` | `"save" \| "type" \| "manual"`    | `"save"` | When diagnostics are published. `"save"` = on document save only; `"type"` = debounced 800 ms after each edit (also on save); `"manual"` = neither — clients must send the custom `chemag/forceCheck` request. |

The mode can be changed at runtime via the standard `workspace/didChangeConfiguration` notification:

```json
{ "settings": { "chemag": { "runOn": "manual" } } }
```

## Capabilities advertised

- `textDocumentSync: Incremental`
- `codeActionProvider: { codeActionKinds: ["quickfix"] }`

## Custom requests

| Method              | Params                | Result                                                | Notes |
|---------------------|-----------------------|-------------------------------------------------------|-------|
| `chemag/forceCheck` | `{ uri: string }`     | `{ ok: true } \| { ok: false, reason: string }`       | Forces a check of `uri` regardless of `runOn` mode. Used by VS Code's "Check workspace" command. |

## Diagnostics produced

Every diagnostic carries `source: "chemag"` and a `code` of the form `CHEM-<group>-<nnn>` (e.g. `CHEM-IMPORT-004`). Run `chemag check --explain CHEM-IMPORT-004` to see the full diagnostic catalog with rationale and remediation guidance.

## Programmatic API

For embedders that want to drive the server in-process (for tests, custom transports, etc.):

```ts
import { runServer } from "@chemag/lsp-server";

const handle = runServer({
  // Pass an explicit Connection (e.g. a paired-stream transport) for tests.
  connection: myConnection,
  // Override the didChange debounce (default: 800 ms).
  debounceMs: 50,
});
```

See `src/server.ts` for the full `ServerHandle` shape.

## License

MIT
