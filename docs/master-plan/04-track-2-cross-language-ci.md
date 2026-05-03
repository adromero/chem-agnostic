# Track 2 — Cross-Language + CI Integration (WP-019 through WP-027)

Track 2 delivers the polyglot promise (TS + Python + Go in one workspace) and the CI/IDE integrations that move chem-ag from "thing I run" to "thing my CI runs and my editor surfaces."

## Sequencing within track

```
WP-019 ─→ WP-020 ─→ WP-021 (Go plugin)
                      ↓
                    WP-022 (multi-lang E2E)
                      ↓
WP-023 (GitHub Action) ─┬─→ WP-024 (GitLab) ─→ WP-025 (Bitbucket)
                         └─→ WP-026 (VS Code) ─→ WP-027 (LSP polish)
```

WP-022 is a pure-test/integration package that gates downstream CI work.

---

## WP-019 — Multi-language workspace schema

**Track:** 2
**Effort:** M
**Depends on:** WP-001
**Blocks:** WP-020, WP-021

### Description

Extend `workspace.yaml` to declare multiple language sub-trees. Each sub-tree has its own root path, language, package conventions, and (optionally) override of role folders.

### Files to modify

- `packages/core/src/types.ts` — extend `Workspace` and `WorkspacePaths`.
- `packages/core/src/loader.ts` — handle the new schema.
- `packages/cli/src/commands/init.ts` — support `--language` becoming a list.
- `packages/cli/src/commands/check.ts`, `analyze.ts` — orchestrate per-sub-tree.

### Schema change

Old:
```yaml
language: typescript
paths:
  compounds: ./src/compounds
```

New (optional, fully backwards-compatible):
```yaml
languages:
  - id: web
    language: typescript
    paths:
      compounds: ./apps/web/src/compounds
      reagents: ./apps/web/src/reagents
    public_surface: public.ts
  - id: api
    language: python
    paths:
      compounds: ./apps/api/src/compounds
    public_surface: __init__.py
    python_packages:
      - api.compounds
  - id: worker
    language: go
    paths:
      compounds: ./apps/worker/compounds
    public_surface: public.go
    go_module_root: ./apps/worker
```

When the new top-level `languages` is present, the legacy `language` and `paths` are ignored.

### Validation rules

- Each sub-tree's path roots must not overlap.
- Each `id` is unique within the workspace.
- Cross-sub-tree imports are forbidden by default (per WP-020 enforcement) but allowed via explicit `allowed_cross_language_imports` (advanced; mostly used for shared-types sub-trees).

### Tests

- Workspace.yaml with 3 sub-trees parses correctly.
- Overlapping paths fail validation.
- Single-language workspaces still parse (backwards compat).

### Acceptance criteria

- [ ] Schema documented in docs site.
- [ ] Reference monorepo (WP-018) uses this schema.
- [ ] Backwards compat: existing single-language workspaces unchanged.

---

## WP-020 — Multi-language plugin orchestration

**Track:** 2
**Effort:** M
**Depends on:** WP-019
**Blocks:** WP-021, WP-022

### Description

Refactor `check`, `analyze`, `scaffold`, `sync`, `graph` to iterate sub-trees and load the correct plugin per sub-tree. Diagnostics aggregate across sub-trees with a `language_id` field.

### Files to modify

- `packages/cli/src/commands/check.ts`, `analyze.ts`, `scaffold.ts`, `sync.ts`, `graph.ts`.
- `packages/core/src/import-check.ts` — accept a list of `{plugin, scope}` pairs.

### Orchestration

For each sub-tree:
1. Load plugin via `loadPlugin(language)`.
2. Load compounds rooted at sub-tree's paths.
3. Run checks scoped to those compounds.
4. Run import-check with that plugin.

Cross-sub-tree behavior:
- A compound in sub-tree A cannot import from sub-tree B unless `allowed_cross_language_imports` permits it (rare).
- A new diagnostic code: `CHEM-IMPORT-CROSS-LANG-001`.

### Graph

The unified `chemag graph` shows all sub-trees, with cross-language compound boundaries rendered as cluster boundaries in Mermaid.

### Tests

- 3-sub-tree fixture with valid + invalid configs.
- Cross-sub-tree imports flagged.
- Plugin selection per sub-tree verified.

### Acceptance criteria

- [ ] Reference monorepo runs `chemag check` and `chemag analyze` cleanly.
- [ ] Mixed-language graph renders.
- [ ] Per-sub-tree perf budget respected (parallelize via Promise.all).

---

## WP-021 — Go language plugin

**Track:** 2
**Effort:** L
**Depends on:** WP-020
**Blocks:** WP-022, polyglot demos

### Description

Implement the Go language plugin parallel to TypeScript and Python. Ships as `@chemag/plugin-go` (npm) bundling a Go helper binary.

### Files to create

- `packages/plugin-go/package.json`
- `packages/plugin-go/src/index.ts` — `LanguagePlugin` impl.
- `packages/plugin-go/src/parser.ts`
- `packages/plugin-go/src/generator.ts`
- `packages/plugin-go/go-helper/` — Go module that does AST parsing, exposes a CLI binary `chemag-go-helper`.
  - `go.mod`
  - `main.go`
  - `parse.go`
  - `inferred.go`
- `packages/plugin-go/scripts/build-helper.sh` — cross-compiles the helper for darwin/linux/windows × amd64/arm64.
- Tests.

### Plugin specifics

- `name`: "go"
- `fileExtensions`: [".go"]
- `defaults`:
  - `publicSurface`: "public.go"
  - `testFilePattern`: `/_test\.go$/`
  - `testFrameworkImport`: "testing"

### Helper subprocess

- Built once during `pnpm install` (postinstall script) or downloaded prebuilt from the npm package's tarball (preferred — bundled binaries ≤5MB per platform).
- Communicates via JSON-RPC over stdio (similar to ts-server, gopls).
- Methods:
  - `parse(file: string) → ParsedImport[]`
  - `parseBatch(files: string[]) → Map<string, ParsedImport[]>`
  - `inferUnits(dir: string, role: string) → InferredUnit[]`
  - `inferImplements(file: string) → string[]` — uses Go interface satisfaction inference.

### Stub generation

Go is opinionated about file naming (lowercase, package-named). Conventions:
- `element/UserId` → `element/user_id.go` with `package element`.
- `interface/OrderRepo` → `interface/order_repo.go` with `package iface` (the package name `interface` is reserved in Go).
- `adapter/PgOrderRepo` → `adapter/pg_order_repo.go`.
- Each role folder is its own Go package by convention.

### Public surface

- `public.go`: re-export pattern via `var X = innerpkg.X` for variables and `type X = innerpkg.X` for types.

### Module resolution

- Reads `go.mod` to determine module root.
- Cross-package imports become `<module>/<rolefolder>/<file>` paths.

### Tests

- Parses a Go fixture file with expected imports.
- Stub generation matches snapshots.
- Public surface generation correct.
- Cross-platform helper binary works (CI matrix: linux + macOS + windows).

### Acceptance criteria

- [ ] `chemag init --language go demo` produces a working Go workspace.
- [ ] `chemag check` and `analyze` work on the Go sub-tree of the reference monorepo.
- [ ] Helper binary bundled in npm package; no `go` runtime needed at user's machine.
- [ ] Plugin documented in docs site.

---

## WP-022 — Cross-language E2E test suite

**Track:** 2
**Effort:** M
**Depends on:** WP-019, WP-020, WP-021
**Blocks:** WP-023..WP-027

### Description

A dedicated E2E package exercising the full multi-language workflow on a copy of the reference monorepo. Run on every PR.

### Files to create

- `packages/cli/test/e2e/multi-language.test.ts`
- `packages/cli/test/e2e/fixtures/polyglot-mini/` — minimal 3-language fixture (≤30 files total) for fast E2E.

### Tests

- `init` for each language.
- `add compound` and `add unit` for each.
- `check`, `analyze`, `graph`, `scaffold`, `sync` work end-to-end.
- Cross-language import properly flagged.
- Vocabulary swap works across languages.

### Acceptance criteria

- [ ] Test suite runs in <60s.
- [ ] No flakes over 100 CI runs.

---

## WP-023 — GitHub Action

**Track:** 2
**Effort:** L
**Depends on:** WP-005 (SARIF), WP-009
**Blocks:** WP-030 (cloud GitHub App)

### Description

A first-class GitHub Action that runs chemag on PRs, surfaces violations as inline review comments, and uploads SARIF to GitHub code scanning.

### Files to create

- `.github/actions/chem-ag/` (composite action used internally).
- `packages/github-action/` — the published runtime (Node-based action).
  - `action.yml`
  - `src/main.ts`
  - `src/comment.ts` — PR comment manager (sticky).
  - `src/sarif-upload.ts`
  - `src/changes.ts` — detects changed files via `octokit`.
  - `dist/index.js` — built bundle (committed; required by GitHub Actions).

### Inputs

```yaml
inputs:
  workspace:
    description: Path to workspace.yaml
    default: workspace.yaml
  command:
    description: chemag command (check | analyze | both)
    default: both
  fail-on:
    description: error | warning | never
    default: error
  format:
    description: human | json | sarif | junit
    default: sarif
  upload-sarif:
    description: Upload SARIF to code scanning
    default: 'true'
  comment-mode:
    description: sticky | append | none
    default: sticky
  changed-only:
    description: Run analyze only on PR-changed files
    default: 'true'
  vocabulary:
    description: standard | chemistry
    default: standard
  github-token:
    default: ${{ github.token }}
```

### Behavior

1. Install chemag CLI (versioned, pinned to action version).
2. Run the configured command; capture diagnostics.
3. If on a PR, post sticky review comment with summary + per-file inline comments.
4. If `upload-sarif: true`, upload via `actions/upload-sarif@v3`.
5. Fail step if `fail-on` threshold met.

### Sticky comment

- One comment per PR, marked with `<!-- chemag:comment -->`.
- Body: summary + table of violations with file:line + a "Run locally" hint.
- Updates in place on subsequent runs.

### Changed-files detection

- Uses GitHub API `pulls.listFiles` (paginated).
- For pushes outside PRs, fetches base commit and diffs.

### Marketplace listing

- `action.yml` includes `branding` (logo + color).
- Published at `chemag-org/action`.
- Versioned `v1`, `v1.0.0`, `latest` tags.

### Tests

- Local runner (act) test with synthetic events.
- Integration: spawn against a real fixture PR in a sandbox repo.

### Acceptance criteria

- [ ] Action installable via `uses: chemag-org/action@v1`.
- [ ] Sticky comment behavior correct across multiple pushes.
- [ ] SARIF appears in GitHub code scanning UI.
- [ ] Failure modes (missing workspace, invalid YAML) produce clear error messages.

---

## WP-024 — GitLab CI template

**Track:** 2
**Effort:** S
**Depends on:** WP-005, WP-023
**Blocks:** none

### Description

GitLab CI template (`.gitlab/ci/chemag.yml`) and corresponding job spec, plus MR comments via GitLab API.

### Files to create

- `packages/cli/src/ci/gitlab.ts` — MR comment poster (used by `chemag ci` mode).
- Templates in `templates/gitlab-ci/`.

### Acceptance criteria

- [ ] Documented as include: `https://chemag.dev/ci/gitlab.yml`.
- [ ] Sticky MR comments work.
- [ ] JUnit output produces nice GitLab MR widget.

---

## WP-025 — Bitbucket Pipes

**Track:** 2
**Effort:** S
**Depends on:** WP-005
**Blocks:** none

### Description

Publish a Bitbucket Pipe (Docker image) that wraps the CLI and posts to Bitbucket PR comments.

### Files to create

- `infra/docker/bitbucket-pipe/Dockerfile`
- `infra/docker/bitbucket-pipe/pipe.yml`
- `packages/cli/src/ci/bitbucket.ts`

### Acceptance criteria

- [ ] Pipe published to Bitbucket Pipe registry.
- [ ] Documented in docs site.

---

## WP-026 — VS Code extension

**Track:** 2
**Effort:** XL
**Depends on:** WP-004, WP-014, WP-015, WP-016
**Blocks:** WP-027

### Description

A first-class VS Code extension surfacing chem-ag diagnostics inline, providing code actions, and exposing the architecture as a sidebar tree view.

### Files to create

`packages/vscode-extension/`:
- `package.json` (manifest)
- `src/extension.ts` — activation, command registration.
- `src/diagnostics-provider.ts` — runs `chemag check` + `analyze` and turns diagnostics into VS Code Diagnostics.
- `src/code-actions.ts` — quick fixes: "move file to compound X", "import from public surface", "add to compound imports list".
- `src/tree-view.ts` — Architecture sidebar (compounds, units, dependencies, violations).
- `src/mcp-bridge.ts` — talks to chemag MCP server for `where_should_this_go` and `validate_edit`.
- `src/status-bar.ts` — shows compound/role of active editor.
- `src/walkthrough/` — first-run walkthrough markdown.
- `media/` — icons, walkthrough images, demo gifs.
- `test/` — vscode-test based tests.

### Features

- Inline diagnostics on save and on typing (debounced 800ms).
- "Move to correct compound" code action when file is in wrong role folder.
- "Wrap in interface" code action when reaction directly imports adapter.
- Sidebar: tree of compounds → units, with badges on units that have violations.
- Status bar: shows current file's compound/role (or "outside chem-ag" if not in a workspace).
- Commands:
  - `chemag: Add compound`
  - `chemag: Add unit`
  - `chemag: Check workspace`
  - `chemag: Show graph` (renders Mermaid in webview)
  - `chemag: Where should this go?` (prompts for description, calls MCP, presents suggestions)
  - `chemag: Install hooks` (runs `chemag install-hooks`)
- Settings:
  - `chemag.cli.path` (auto-detected)
  - `chemag.vocabulary` (default standard)
  - `chemag.runOn` ("save" | "type" | "manual")

### Distribution

- Published to VS Code Marketplace.
- Auto-update.
- Telemetry follows the global `chemag` telemetry consent (extension reads `~/.config/chemag/config.json`).

### Tests

- Activation works in a fixture workspace.
- Diagnostics surface for known violations.
- Code actions work on click.
- Sidebar populates.
- Tested against vscode-test on Linux + macOS + Windows.

### Acceptance criteria

- [ ] Installable from Marketplace.
- [ ] Walkthrough completes in <2 minutes for a new user.
- [ ] Demo video recorded for marketing.
- [ ] Performance: extension activation <200ms, diagnostics latency <500ms after save.

---

## WP-027 — LSP server polish

**Track:** 2
**Effort:** M
**Depends on:** WP-026
**Blocks:** v1.1 JetBrains/Zed plugins (out of scope for v1.0 but unblocks)

### Description

Refactor the VS Code extension's diagnostics + code-actions into a standalone LSP server (using `vscode-languageserver-node`). The VS Code extension becomes a thin client. Other LSP-capable editors (Zed, Helix, Neovim) can use the same server.

### Files to create

- `packages/vscode-extension/server/` — the LSP server implementation.
- `packages/vscode-extension/client/` — minimal LSP client.

### Acceptance criteria

- [ ] LSP server runs standalone (`chemag lsp`) for non-VS Code editors.
- [ ] VS Code extension uses the LSP server (functional parity preserved).
- [ ] Documented for community LSP integrations.
