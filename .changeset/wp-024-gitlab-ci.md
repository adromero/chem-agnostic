---
"@chemag/core": patch
"@chemag/cli": minor
---

GitLab CI integration + shared sticky-comment marker (WP-024).

New `chemag ci gitlab` subcommand posts a sticky MR comment via the GitLab REST API, keyed by the `<!-- chemag:comment -->` marker. Auth via `GITLAB_TOKEN` + `CI_PROJECT_ID` + `CI_MERGE_REQUEST_IID`. Companion CI include template at `templates/gitlab-ci/chemag.yml` for consumers' `.gitlab-ci.yml`. JUnit output integrates with GitLab's native MR widget.

`@chemag/core` exports a new `ci-marker` module (`STICKY_MARKER`, `hasMarker`, `wrapWithMarker`) — the constants previously lived in `packages/github-action/src/comment.ts` but are now shared so GitLab and Bitbucket integrations don't need to duplicate them. Available via the `@chemag/core` barrel and via the `@chemag/core/ci-marker` subpath. Behavior is byte-identical (the marker string is unchanged), so existing PR comments from prior runs are still detected.
