# Track 2 Follow-ups (WP-027b through WP-026f)

These work packages resolve the two deferrals from Track 2:
- **WP-027b**: standalone `chemag lsp` CLI command (deferred from WP-027 → v0.3 by the arbiter, who picked option C: keep server inside `chemag-vscode`).
- **WP-026b through WP-026f**: VS Code extension v0.2 surface (the items wp-026's arbiter explicitly listed as "NOT in scope" for the v0.1 MVP).

The Track 2 v1.0 contract — multi-language workspaces, per-sub-tree orchestration, Go plugin, GitHub Action, GitLab CI, Bitbucket Pipes, VS Code MVP — is unchanged. These follow-ups round out the IDE surface and unblock v1.1 plugin authors targeting Zed/Helix/Neovim.

## Sequencing

```
WP-027b ─→ WP-026b
            ↓
        (independent fan-out)
            ├─→ WP-026c (tree-view)
            ├─→ WP-026d (4 missing commands)
            ├─→ WP-026e (Mermaid webview)
            └─→ WP-026f (walkthrough + media)
```

WP-027b extracts the LSP server into its own workspace package. WP-026b depends on it only because the cleanest extension-side code-action wiring imports the LSP `CodeAction` shape from the new package. WP-026c-f are independent fan-out work that all depend on the WP-026 v0.1 MVP only — they can run in parallel after WP-026b lands (or even concurrently with it if the worker is careful).

---

## WP-027b — Standalone `chemag lsp` CLI command

**Track:** 2 follow-up
**Effort:** M
**Depends on:** WP-027 (LSP server inside `chemag-vscode/server`)
**Blocks:** WP-026b
**Resolves:** WP-027 arbiter notes round-2 §3 — deferred Plan Text acceptance criterion "LSP server runs standalone (`chemag lsp`)"

### Description

Extract the LSP server from `packages/vscode-extension/server/` into a new top-level workspace package `@chemag/lsp-server`. Both `chemag-vscode` (the VS Code extension) and `@chemag/cli` (via a new `chemag lsp` subcommand) depend on it via `workspace:*`. This is **resolution A** of the three the WP-027 arbiter considered, chosen now that the rest of Track 2 is shipped and there's budget for a clean architectural fix vs the wp-027-time hacks.

### Files to move (from `packages/vscode-extension/server/` → `packages/lsp-server/`)
- `package.json` → renamed to `@chemag/lsp-server`, drop `chemag-vscode-lsp-server`. Become publishable (`private: false`).
- `tsconfig.json`, `vitest.config.ts`, `scripts/build.js` — unchanged.
- `src/server.ts`, `src/diagnostics.ts`, `src/code-actions.ts`, `src/workspace-state.ts` — unchanged.
- `test/server.test.ts` — unchanged.

### Files to create
- `packages/lsp-server/src/index.ts` — barrel re-exporting `runServer`, `buildDiagnostics`, `buildCodeActions`, `STICKY_MARKER` shapes etc. that downstream consumers (CLI, future Zed/Helix/Neovim plugins) need.
- `packages/cli/src/commands/lsp.ts` — `chemag lsp` subcommand. Imports `runServer` from `@chemag/lsp-server` and boots it over stdio.
- `packages/cli/test/commands/lsp.test.ts` — unit test that `chemag lsp` invokes `runServer`.

### Files to modify
- `pnpm-workspace.yaml` — replace the `packages/vscode-extension/server` entry with the new `packages/lsp-server` location (and drop the explicit nesting carve-out — `packages/*` covers it again).
- `packages/cli/package.json` — add `"@chemag/lsp-server": "workspace:*"` to dependencies.
- `packages/cli/src/cli.ts` — register the `lsp` command in the dispatch switch.
- `packages/cli/src/cli-meta.ts` — TWO coordinated edits: add `lsp` to `subCommands` AND to the `"Integrations"` `COMMAND_GROUPS` entry (recurring trap from WP-024).
- `packages/vscode-extension/package.json` — change the dep on `chemag-vscode-lsp-server` (workspace:*) to `@chemag/lsp-server` (workspace:*).
- `packages/vscode-extension/src/client/client.ts` — server module path: was `path.join(extensionPath, "server", "dist", "server.js")`; now resolve via `require.resolve("@chemag/lsp-server/dist/server.js")`. The bundled extension (.vsix) inlines the server into `dist/extension.js` via esbuild's transitive trace — so `client.ts` should spawn `node` with the bundled server module, NOT the package path. Concretely: ship the server bundle inside the .vsix at `dist/server.js` (via a parallel esbuild entry point in `esbuild.config.js`) and have the client point to that.
- `packages/vscode-extension/esbuild.config.js` — add a second entry `entryPoints: ["src/extension.ts", "node_modules/@chemag/lsp-server/dist/server.js"]` (or run a second esbuild pass) so the .vsix ships both `dist/extension.js` AND `dist/server.js` self-contained.
- `packages/vscode-extension/.vscodeignore` — drop the now-obsolete `!server/dist/` carve-out; ensure `dist/server.js` ships.
- `vitest.shared.ts` — add `"@chemag/lsp-server": r("packages/lsp-server/src/index.ts")` and `"@chemag/lsp-server/dist/server.js": r("packages/lsp-server/src/server.ts")` aliases so tests resolve without a build.
- `packages/core/package.json` (if needed): no change expected — the lsp-server already depends on `@chemag/core` via workspace.

### Files to delete
- `packages/vscode-extension/server/` — the entire sub-tree (after copying contents to `packages/lsp-server/`).

### Test criteria
- `chemag lsp --help` prints usage; `chemag --help` lists `lsp` under `Integrations`.
- `chemag lsp` (no args) boots a stdio LSP server that responds to a synthetic `initialize` request with the same capabilities as the wp-027 baseline.
- `pnpm --filter @chemag/lsp-server test` runs the existing 9 protocol tests, all green.
- `pnpm --filter @chemag/cli test commands/lsp` passes the new unit test.
- `pnpm --filter chemag-vscode test` still passes — the extension's LSP client now spawns `dist/server.js` (bundled, .vsix-internal) instead of `server/dist/server.js` (sub-package path). Extension activation test still green.
- `pnpm --filter chemag-vscode build` produces both `dist/extension.js` AND `dist/server.js`, both <1 MB.
- `pnpm typecheck`, `pnpm test`, `pnpm lint` — all green.
- A consumer who installs `@chemag/cli` from npm can run `chemag lsp` and connect from any LSP-capable editor (validated by mock-spawning + `initialize` request).

### Acceptance criteria
- [ ] `@chemag/lsp-server` is a publishable workspace package.
- [ ] `chemag lsp` subcommand boots the same server as the VS Code extension.
- [ ] VS Code extension still spawns the server but from the .vsix-bundled path, not the workspace sub-package.
- [ ] `pnpm-workspace.yaml` no longer needs the explicit nested-package carve-out.
- [ ] Documented in `packages/lsp-server/README.md` for Zed/Helix/Neovim plugin authors.

---

## WP-026b — Wire LSP code actions into VS Code quick-fix UI

**Track:** 2 follow-up
**Effort:** S
**Depends on:** WP-027b
**Blocks:** none

### Description

The wp-027 LSP server already serves `textDocument/codeAction` requests with all five remediation kinds (`use_interface`, `move_to_compound`, `move_to_role_folder`, `import_via_public_surface`, `add_compound_import`). The VS Code extension's LSP client receives these but doesn't yet surface them as VS Code's native quick-fix lightbulbs. This stage wires that last mile.

### Files to modify
- `packages/vscode-extension/src/client/client.ts` — confirm `clientOptions` enables code-action capability negotiation. The `@vscode/vscode-languageclient` library handles most of this automatically; the explicit work is to ensure `clientCapabilities.textDocument.codeAction.codeActionLiteralSupport` is set so the server can return `CodeAction[]` (not just `Command[]`).
- `packages/vscode-extension/src/extension.ts` — register a code-action provider IF the LSP client doesn't auto-register one (it should, but verify and document).

### Files to create
- `packages/vscode-extension/test/suite/code-actions.test.ts` — Mocha (TDD) test that opens a fixture file with a known CHEM-IMPORT-CROSS-LANG-001 violation, requests code actions at the offending range, and asserts at least one `WorkspaceEdit`-bearing `CodeAction` is returned with kind `QuickFix`.

### Test criteria
- `vscode.commands.executeCommand("vscode.executeCodeActionProvider", uri, range)` returns at least one `CodeAction` for each of the five remediation kinds when a fixture exercises them.
- Applying a returned `WorkspaceEdit` (e.g., `move_to_role_folder`) produces the expected file rename + import-path adjustments.
- Existing wp-026/wp-027 tests still pass.
- `pnpm --filter chemag-vscode test`, `pnpm typecheck`, `pnpm lint` — green.

### Acceptance criteria
- [ ] Hovering on a chemag diagnostic in VS Code surfaces a quick-fix lightbulb.
- [ ] At least one quick fix per remediation kind is offered when the relevant violation is present.
- [ ] Activating a quick fix mutates the workspace correctly (verified via vscode-test).

---

## WP-026c — Architecture sidebar tree view

**Track:** 2 follow-up
**Effort:** M
**Depends on:** WP-026 v0.1 MVP (no transitive dep on 027b)
**Blocks:** none

### Description

Ship the Architecture sidebar tree view originally listed in the WP-026 plan ("Sidebar: tree of compounds → units, with badges on units that have violations"). Uses VS Code's `TreeDataProvider` + `TreeView` API. Reads workspace + compound state via `@chemag/core`'s loader. Refreshes on file-change events (workspace.yaml + compound.yaml mtime).

### Files to create
- `packages/vscode-extension/src/tree-view.ts` — `TreeDataProvider` implementation. Three node levels: compound → role folder → unit. Decorations: violation count badge per unit/compound (read from the LSP client's published diagnostics).
- `packages/vscode-extension/test/suite/tree-view.test.ts` — assert tree populates from the fixture workspace and refreshes on file change.

### Files to modify
- `packages/vscode-extension/src/extension.ts` — instantiate `TreeView` and register on `context.subscriptions`.
- `packages/vscode-extension/package.json` — add `contributes.viewsContainers` (activitybar entry with chemag icon) and `contributes.views` (the tree view itself).

### Test criteria
- After activation, the chemag activity-bar entry is visible.
- Clicking it reveals the tree populated from the fixture's workspace.yaml.
- Triggering a file change (touch a compound.yaml) refreshes the tree.
- Violation badges appear on units that have published diagnostics.
- `pnpm --filter chemag-vscode test`, `pnpm typecheck`, `pnpm lint` — green.

### Acceptance criteria
- [ ] Sidebar visible in VS Code's activity bar after extension activation.
- [ ] Tree populates with compound/role/unit hierarchy from the loaded workspace.
- [ ] Violation badges update when diagnostics change.

---

## WP-026d — Four missing commands (Add compound, Add unit, Where should this go?, Install hooks)

**Track:** 2 follow-up
**Effort:** M
**Depends on:** WP-026 v0.1 MVP
**Blocks:** none

### Description

Wire the four commands the wp-026 v0.1 MVP deferred. Each is a thin VS Code wrapper around an existing CLI subcommand or MCP tool. No new CLI work — just the VS Code-side `vscode.commands.registerCommand` + input prompts + output handling.

### Files to create
- `packages/vscode-extension/src/commands/add-compound.ts` — prompts for compound name, runs `chemag add compound <name>`, surfaces output in the chemag OutputChannel.
- `packages/vscode-extension/src/commands/add-unit.ts` — prompts for compound (drop-down from the loaded workspace) + role + unit name, runs `chemag add unit <compound> <role> <name>`.
- `packages/vscode-extension/src/commands/where-should-this-go.ts` — prompts for a free-text description, calls the MCP server's `where_should_this_go` tool via `mcp-bridge.ts`, presents results in a `vscode.window.showQuickPick`.
- `packages/vscode-extension/src/commands/install-hooks.ts` — prompts for tool selection (claude/cursor/codex/aider/cline/copilot), runs `chemag install-hooks --tool <tool>`.
- `packages/vscode-extension/test/suite/commands.test.ts` — assert each new command is registered and (with mocked `vscode.window.showInputBox`/`showQuickPick`) invokes the right CLI subcommand.

### Files to modify
- `packages/vscode-extension/src/extension.ts` — register all 4 new commands.
- `packages/vscode-extension/package.json` — add 4 entries to `contributes.commands` + 4 entries to `activationEvents` (`onCommand:chemag.addCompound`, etc.).

### Test criteria
- All 6 commands now registered (the 2 MVP commands + 4 new ones).
- Each new command, with mocked input prompts, invokes the corresponding subprocess and reports completion in the OutputChannel.
- The `where-should-this-go` command flows through `mcp-bridge.ts` and renders MCP tool results in a quick-pick.
- `pnpm --filter chemag-vscode test`, `pnpm typecheck`, `pnpm lint` — green.

### Acceptance criteria
- [ ] All 4 commands appear in the VS Code Command Palette.
- [ ] Each command runs end-to-end against the fixture workspace.
- [ ] No regressions in wp-026's existing 2 MVP commands.

---

## WP-026e — Mermaid webview for "Show graph"

**Track:** 2 follow-up
**Effort:** S
**Depends on:** WP-026 v0.1 MVP
**Blocks:** none

### Description

The wp-026 v0.1 MVP's `chemag.showGraph` command dumps Mermaid source into an untitled markdown document (deliberately minimal). Upgrade it to render the graph in a `vscode.window.createWebviewPanel` using the `mermaid` npm package or a vendored CDN reference.

### Files to modify
- `packages/vscode-extension/src/commands/show-graph.ts` — create a webview panel; build an HTML document containing the Mermaid `<script>` tag + the diagram source. Subscribe to the LSP client's diagnostics to refresh the graph when violations change (optional polish).
- `packages/vscode-extension/package.json` — add `mermaid` (or vendored) to `dependencies`. The extension is bundled by esbuild so this gets inlined into `dist/extension.js`.

### Files to create
- `packages/vscode-extension/src/webviews/graph-html.ts` — small helper that returns the HTML scaffold (locked-down Content Security Policy, no remote scripts).
- `packages/vscode-extension/test/suite/show-graph.test.ts` — assert the command opens a webview and the webview's HTML contains the Mermaid source from the fixture.

### Test criteria
- Running `chemag.showGraph` opens a Webview Panel (visible to vscode-test via `vscode.window.activeWebview`).
- The webview HTML contains a `<pre class="mermaid">…</pre>` block matching the chemag CLI's graph output for the fixture.
- The webview's CSP forbids remote scripts (mermaid is bundled or CDN-pinned with SRI).
- `pnpm --filter chemag-vscode build` size: still <1 MB extension bundle (mermaid adds ~100-200 KB).
- `pnpm --filter chemag-vscode test`, `pnpm typecheck`, `pnpm lint` — green.

### Acceptance criteria
- [ ] Running "chemag: Show graph" renders a real graph in a webview, not raw text.
- [ ] Webview survives panel reopens (state preservation via `getState`/`setState`).

---

## WP-026f — Walkthrough + marketing assets

**Track:** 2 follow-up
**Effort:** S
**Depends on:** WP-026 v0.1 MVP
**Blocks:** none (gates VS Code Marketplace listing, but publishing is still out of scope until v1.0)

### Description

Ship the first-run walkthrough + media assets the wp-026 v0.1 MVP deferred. VS Code's `walkthroughs` contribution point: a sequence of markdown steps with screenshots/gifs that activate when the extension is installed for the first time.

### Files to create
- `packages/vscode-extension/src/walkthrough/getting-started.md` — primary walkthrough markdown. Three steps: (1) "What is chemag?" (one-screen overview), (2) "Open a workspace" (point at the polyglot-mini fixture), (3) "Run your first check" (invoke chemag.checkWorkspace).
- `packages/vscode-extension/src/walkthrough/{step1,step2,step3}.md` — per-step deeplinked markdown if needed.
- `packages/vscode-extension/media/icon.png` — extension icon (128x128 PNG, simple beaker/molecule motif). Placeholder acceptable; production-grade asset is a separate design task.
- `packages/vscode-extension/media/walkthrough/*.png` — screenshots referenced by the walkthrough markdown. Capture against the polyglot-mini fixture.

### Files to modify
- `packages/vscode-extension/package.json` — add `contributes.walkthroughs[]` entry with steps + thumbnail references; bump `icon` field to point at `media/icon.png`.
- `packages/vscode-extension/.vscodeignore` — ensure `media/` ships in the .vsix.
- `packages/vscode-extension/README.md` — embed the icon + a "Getting started" link to the walkthrough.

### Test criteria
- Walkthrough renders in VS Code's "Get Started" page after a fresh install (verified manually + via vscode-test if feasible).
- All referenced images exist in the .vsix.
- Bundle still <1 MB after media is included (PNGs total ≤500 KB).
- `pnpm --filter chemag-vscode package` produces a .vsix containing the walkthrough markdown + media.

### Acceptance criteria
- [ ] Walkthrough completes end-to-end in <2 minutes for a new user (matches the inherited wp-026 plan-text criterion).
- [ ] All media assets present and referenced correctly.

---

## Cross-cutting concerns

- **No new diagnostic codes** are added in any of these stages, so the wp-019/wp-024-style coordinated 5-file registration trap doesn't apply.
- **wp-027b's package extraction** is the only structurally invasive change. The other 5 stages are additive within the existing `chemag-vscode` package.
- **Bundle size budget**: keep `dist/extension.js` < 1 MB. Mermaid (wp-026e) is the largest single addition; verify size after each merge.
- **No marketplace publishing** — stays out of scope until v1.0 GA, per the global deferral policy.
- **Changesets**: each WP that touches a publishable package needs a changeset (wp-027b → minor on @chemag/cli + new @chemag/lsp-server; wp-026b/c/d/e/f all on private chemag-vscode → no changeset needed).
