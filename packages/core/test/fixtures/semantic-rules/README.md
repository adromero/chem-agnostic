# Semantic-rule fixtures

This directory holds self-contained chemag workspaces used by the Track R
semantic-rule tests. Fixtures are laid out as `<rule-id>/valid/<name>/` and
`<rule-id>/invalid/<name>/`, where each leaf is a complete workspace rooted at
its own `workspace.yaml`. The test helper at
`packages/core/test/helpers/run-fixture.ts` resolves a fixture by absolute or
relative directory path, loads its `workspace.yaml`, runs the `allChecks`
pipeline plus `checkImports` in-process, and returns
`{ checkDiagnostics, analyzeDiagnostics }`. The `_baseline/` directory holds
the minimum-viable fixtures used to validate the harness itself (currently
`invalid/duplicate-compound/` which fires `CHEM-MANIFEST-001`, and
`valid/empty-workspace/` which fires nothing). The analyze phase requires a
`LanguagePlugin`; the helper defaults to a no-op plugin so check-only fixtures
work out of the box, and tests that need richer import-resolution behaviour
pass an in-memory mock via the helper's `plugin` option (see the
`mockPlugin(importMap, resolutions)` pattern in
`packages/core/test/import-check.test.ts`).

Example layout:

```
semantic-rules/
  _baseline/
    invalid/
      duplicate-compound/
        workspace.yaml
        src/compounds/alpha/compound.yaml   # compound: dup
        src/compounds/beta/compound.yaml    # compound: dup
    valid/
      empty-workspace/
        workspace.yaml
        src/compounds/                       # no compound dirs
  CHEM-IMPORT-NNN/
    valid/<name>/
    invalid/<name>/
```
