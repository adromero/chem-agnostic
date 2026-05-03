---
"@chemag/core": minor
"@chemag/cli": minor
---

Multi-language workspace schema (WP-019).

`Workspace` gains a `languages: LanguageSubtree[]` field declaring per-sub-tree language, paths, public_surface, and (optionally) `allowed_cross_language_imports`. The loader normalizes both directions: multi-language YAMLs populate the legacy `language`/`paths` from `languages[0]` so single-plugin call sites keep working; legacy single-language YAMLs synthesize a `[{ id: "default", ... }]` array so downstream code can uniformly iterate.

`discoverCompounds` now scans every sub-tree. New manifest checks `CHEM-MANIFEST-003` (subtree paths overlap) and `CHEM-MANIFEST-004` (duplicate subtree id). `chemag init` accepts `--language` as a repeatable flag; multi-value invocations emit a `languages:` block and scaffold per-sub-tree directories. Backwards-compatible: existing single-language workspaces parse and validate unchanged.
