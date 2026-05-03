# @chemag/mcp-server

## 0.0.1

### Patch Changes

- 4ab7c84: Multi-language plugin orchestration (WP-020).

  `checkImports` accepts `Array<{plugin, scope, compounds}>` (`ImportCheckScope[]`) and iterates per sub-tree. Cross-sub-tree imports flagged with new diagnostic `CHEM-IMPORT-CROSS-LANG-001` (new `IMPORT-CROSS-LANG` category) unless allow-listed via the sub-tree's `allowed_cross_language_imports`. `Diagnostic.language_id?: string` added so aggregated output identifies the source sub-tree.

  `CheckImportsHooks.parseImportsBatch` evolves to `(filePaths, plugin, scope) => Map<...>` invoked once per sub-tree (preserves the existing per-file content cache without forcing a global rewrite). CLI commands `check`, `analyze`, `scaffold`, `sync`, `graph` iterate sub-trees; `chemag graph` renders each sub-tree as a Mermaid `subgraph` cluster.

  `@chemag/mcp-server` is updated to wrap the workspace's primary sub-tree as a 1-element `ImportCheckScope[]` (single-plugin call path retained; multi-plugin MCP is a follow-up).

- Updated dependencies [4ab7c84]
- Updated dependencies [4ab7c84]
- Updated dependencies [4ab7c84]
  - @chemag/core@0.2.0
  - @chemag/plugin-python@0.1.1
  - @chemag/plugin-typescript@0.1.1
