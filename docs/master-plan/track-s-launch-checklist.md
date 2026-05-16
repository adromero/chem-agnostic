# Track S — Launch Checklist (operator workflow)

This document is the master checklist for shipping
`eslint-plugin-port-discipline` and winding down chemag-the-framework.
The autonomous Track-S work (S01-S05, S08) staged every artifact; this
document is the order the operator runs through to actually ship.

**Status banner:** All launch artifacts staged. **NOTHING was published
or posted** — the operator executes the manual steps below.

## Pre-flight (S07 prerequisites)

- [ ] Top-level `README.md` reviewed and signed off. The operator-review
      banner currently at the top of `README.md` is removed once the
      content reads correctly.
- [ ] Fresh clone + `pnpm install` + `pnpm test` + `pnpm typecheck` +
      `pnpm build` — all green.
- [ ] `RUN_PACK_TEST=1 pnpm --filter eslint-plugin-port-discipline test`
      passes (network-bound, ~10s).
- [ ] Changeset for `eslint-plugin-port-discipline@0.1.0` exists at
      `.changeset/eslint-plugin-port-discipline-initial.md`. Edit the
      bump kind (minor → major) if you want 1.0.0 instead of 0.1.0.
- [ ] CodelyTV Discussion text reviewed:
      `docs/launch/codelytv-discussion.md`.
- [ ] HN submission text reviewed:
      `docs/launch/hn-submission.md`.
- [ ] r/typescript submission text reviewed:
      `docs/launch/reddit-submission.md`.

## Publish (WP-S07 manual steps)

1. Push `main`. The Changesets `release.yml` workflow opens a
   "Version Packages" PR. Merge it — this triggers `npm publish` for
   `eslint-plugin-port-discipline`.
2. Verify the package landed:
   ```
   npm view eslint-plugin-port-discipline
   ```
3. Tag `v1.0.0` on `main` and push the tag:
   ```
   git tag v1.0.0
   git push origin v1.0.0
   ```
4. Update the GitHub repo's "About" description to:
   `"Three TypeScript ESLint rules + the bench that produced them"`.

## CodelyTV contribution (WP-S06 manual steps)

1. Open a Discussion in
   `CodelyTV/eslint-plugin-hexagonal-architecture` titled:
   *"Three port-discipline rules — interested in contribution?"*

   Body: use `docs/launch/codelytv-discussion.md` verbatim.

2. Wait **14 days**. If response is positive: open three small PRs
   using the per-rule scaffolding in `docs/launch/codelytv-prs/`.

3. Record outcome in the top-level README under "Related work".

## Community submission (WP-S07 continued)

1. Hacker News submission: title + comment-1 from
   `docs/launch/hn-submission.md`.
2. r/typescript submission: title + body from
   `docs/launch/reddit-submission.md`.
3. One round only. No follow-up grinding.

## After launch

- [ ] Watch npm downloads and star count for one month. If
      `eslint-plugin-port-discipline` crosses 100 stars or sees
      meaningful npm downloads, revisit per ADR-0007's long-term
      consequences section.
- [ ] If CodelyTV merges any of the rules, update the README's
      "Related work" section and either deprecate the standalone
      plugin or note its coexistence with theirs.
