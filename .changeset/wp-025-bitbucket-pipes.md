---
"@chemag/cli": minor
---

Bitbucket Pipes (WP-025).

New `chemag ci bitbucket` subcommand posts a sticky PR comment via the Bitbucket Cloud REST API, reusing the `<!-- chemag:comment -->` marker from `@chemag/core/ci-marker`. Auth via `BITBUCKET_TOKEN` + `BITBUCKET_REPO_FULL_NAME` + `BITBUCKET_PR_ID`. Bundled as a Bitbucket Pipe Docker image at `infra/docker/bitbucket-pipe/`.

The Bitbucket REST plumbing diverges from GitLab in three structural ways (each pinned by a dedicated test):
- request body uses `{ content: { raw } }`, not `{ body }`
- auth header is `Authorization: Bearer <token>`, not `PRIVATE-TOKEN`
- pagination follows `response.next` cursor URLs, not `?page=N`

Comments are filtered by `inline` and `parent` fields (Bitbucket has no `system` flag), with a defensive `MAX_PAGES = 200` cap on cursor iteration.
