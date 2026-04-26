# Changesets

This directory drives versioning and changelog generation for every public `@chemag/*` package.

## Workflow

1. After a PR introduces a user-visible change to one or more packages, run:

   ```bash
   pnpm changeset
   ```

2. Pick the affected packages and the bump kind (`patch`, `minor`, `major`).
3. Write a one-paragraph summary that will appear verbatim in the changelog.
4. Commit the generated `.changeset/<some-name>.md` file alongside your code changes.

## Release flow

`release.yml` runs on `main`:

- Opens (or updates) a "Version Packages" PR that consumes pending changesets, bumps versions, and updates `CHANGELOG.md` files.
- When that PR is merged, it publishes every bumped package to npm with provenance.

## What does NOT need a changeset

- Internal refactors that ship no observable change to consumers.
- Test-only or docs-only changes.
- Workspace tooling (`turbo.json`, `biome.json`, etc.).

If you are unsure, err on the side of including a changeset.

## Ignored packages

`@chemag/telemetry` is currently a placeholder and is excluded from the release set. Once WP-006 lands, remove it from the `ignore` array in `config.json`.
