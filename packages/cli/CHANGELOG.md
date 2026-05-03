# @chemag/cli

## 0.2.0

### Minor Changes

- 4ab7c84: Multi-language workspace schema (WP-019).

  `Workspace` gains a `languages: LanguageSubtree[]` field declaring per-sub-tree language, paths, public_surface, and (optionally) `allowed_cross_language_imports`. The loader normalizes both directions: multi-language YAMLs populate the legacy `language`/`paths` from `languages[0]` so single-plugin call sites keep working; legacy single-language YAMLs synthesize a `[{ id: "default", ... }]` array so downstream code can uniformly iterate.

  `discoverCompounds` now scans every sub-tree. New manifest checks `CHEM-MANIFEST-003` (subtree paths overlap) and `CHEM-MANIFEST-004` (duplicate subtree id). `chemag init` accepts `--language` as a repeatable flag; multi-value invocations emit a `languages:` block and scaffold per-sub-tree directories. Backwards-compatible: existing single-language workspaces parse and validate unchanged.

- 4ab7c84: Multi-language plugin orchestration (WP-020).

  `checkImports` accepts `Array<{plugin, scope, compounds}>` (`ImportCheckScope[]`) and iterates per sub-tree. Cross-sub-tree imports flagged with new diagnostic `CHEM-IMPORT-CROSS-LANG-001` (new `IMPORT-CROSS-LANG` category) unless allow-listed via the sub-tree's `allowed_cross_language_imports`. `Diagnostic.language_id?: string` added so aggregated output identifies the source sub-tree.

  `CheckImportsHooks.parseImportsBatch` evolves to `(filePaths, plugin, scope) => Map<...>` invoked once per sub-tree (preserves the existing per-file content cache without forcing a global rewrite). CLI commands `check`, `analyze`, `scaffold`, `sync`, `graph` iterate sub-trees; `chemag graph` renders each sub-tree as a Mermaid `subgraph` cluster.

  `@chemag/mcp-server` is updated to wrap the workspace's primary sub-tree as a 1-element `ImportCheckScope[]` (single-plugin call path retained; multi-plugin MCP is a follow-up).

- 4ab7c84: GitLab CI integration + shared sticky-comment marker (WP-024).

  New `chemag ci gitlab` subcommand posts a sticky MR comment via the GitLab REST API, keyed by the `<!-- chemag:comment -->` marker. Auth via `GITLAB_TOKEN` + `CI_PROJECT_ID` + `CI_MERGE_REQUEST_IID`. Companion CI include template at `templates/gitlab-ci/chemag.yml` for consumers' `.gitlab-ci.yml`. JUnit output integrates with GitLab's native MR widget.

  `@chemag/core` exports a new `ci-marker` module (`STICKY_MARKER`, `hasMarker`, `wrapWithMarker`) — the constants previously lived in `packages/github-action/src/comment.ts` but are now shared so GitLab and Bitbucket integrations don't need to duplicate them. Available via the `@chemag/core` barrel and via the `@chemag/core/ci-marker` subpath. Behavior is byte-identical (the marker string is unchanged), so existing PR comments from prior runs are still detected.

- 4ab7c84: Bitbucket Pipes (WP-025).

  New `chemag ci bitbucket` subcommand posts a sticky PR comment via the Bitbucket Cloud REST API, reusing the `<!-- chemag:comment -->` marker from `@chemag/core/ci-marker`. Auth via `BITBUCKET_TOKEN` + `BITBUCKET_REPO_FULL_NAME` + `BITBUCKET_PR_ID`. Bundled as a Bitbucket Pipe Docker image at `infra/docker/bitbucket-pipe/`.

  The Bitbucket REST plumbing diverges from GitLab in three structural ways (each pinned by a dedicated test):

  - request body uses `{ content: { raw } }`, not `{ body }`
  - auth header is `Authorization: Bearer <token>`, not `PRIVATE-TOKEN`
  - pagination follows `response.next` cursor URLs, not `?page=N`

  Comments are filtered by `inline` and `parent` fields (Bitbucket has no `system` flag), with a defensive `MAX_PAGES = 200` cap on cursor iteration.

### Patch Changes

- 4ab7c84: Go language plugin (WP-021).

  New package `@chemag/plugin-go` parallel to `@chemag/plugin-typescript` and `@chemag/plugin-python`. Bundles a Go helper binary (`chemag-go-helper`) doing AST parsing via JSON-RPC over stdio. Prebuilt binaries for darwin/linux/windows × amd64/arm64 ship in the npm tarball under `bin/<os>-<arch>/` — no `go` runtime needed at the user's machine. No `postinstall` script.

  Stub generation honors Go conventions: lowercase snake_case files; role-folder = package; the reserved `interface/` role is rewritten to `package iface`. `public.go` re-exports use `type X = innerpkg.X` for type-roles and `var X = innerpkg.X` for value-roles.

  `@chemag/cli` registers the new plugin via `plugin-loader.ts`; `chemag init --language go demo` writes `workspace.yaml` + `go.mod` and warns via `checkGoAvailable()` when no Go toolchain is on PATH. Plugin tests skip cleanly when neither the prebuilt binary nor a `go` toolchain is available — same gating pattern as the Python plugin.

- Updated dependencies [4ab7c84]
- Updated dependencies [4ab7c84]
- Updated dependencies [4ab7c84]
- Updated dependencies [4ab7c84]
  - @chemag/core@0.2.0
  - @chemag/mcp-server@0.0.1
  - @chemag/plugin-go@0.2.0
  - @chemag/plugin-python@0.1.1
  - @chemag/plugin-typescript@0.1.1
