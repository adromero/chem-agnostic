# chemag — Bitbucket Pipe

A [Bitbucket Pipe](https://support.atlassian.com/bitbucket-cloud/docs/use-pipes-in-bitbucket-pipelines/)
that runs the [`chemag`](https://www.npmjs.com/package/@chemag/cli) architecture
checker against your repository on every pull request and posts (or updates in
place) a sticky comment summarising the diagnostics.

## Usage

```yaml
# bitbucket-pipelines.yml
pipelines:
  pull-requests:
    '**':
      - step:
          name: chemag
          script:
            - pipe: chemag/bitbucket-pipe:latest
              variables:
                BITBUCKET_TOKEN: $BITBUCKET_TOKEN
                # Optional — defaults to ./workspace.yaml
                # CHEMAG_WORKSPACE: path/to/workspace.yaml
```

`BITBUCKET_REPO_FULL_NAME` and `BITBUCKET_PR_ID` are populated automatically by
Bitbucket Pipelines on pull-request pipelines and do not need to be passed
explicitly.

## Required variables

| Name | Required | Description |
| --- | --- | --- |
| `BITBUCKET_TOKEN` | yes | OAuth token or app password with `pullrequest:write` scope. Set as a [secured repository variable](https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/). |
| `BITBUCKET_REPO_FULL_NAME` | yes (auto) | `<workspace>/<repo>` — Bitbucket Pipelines sets this automatically on PR pipelines. |
| `BITBUCKET_PR_ID` | yes (auto) | Numeric PR id — Bitbucket Pipelines sets this automatically on PR pipelines. |
| `CHEMAG_WORKSPACE` | no | Path to `workspace.yaml`. Defaults to `workspace.yaml`. |

## What the pipe does

1. Runs `chemag check <workspace> --format json` and captures the JSON diagnostics envelope.
2. Pipes the envelope into `chemag ci bitbucket`, which posts a sticky PR comment via the Bitbucket REST API. Subsequent runs of the pipe update the same comment in place rather than appending new ones — the sticky-comment marker is `<!-- chemag:comment -->` on line one.
3. Exits with chemag's original exit code, so the pipeline still fails on real architectural violations.

## Local Docker build

The image is built from `Dockerfile` in this directory:

```sh
docker build -t chemag/bitbucket-pipe:dev infra/docker/bitbucket-pipe/
```

## Publishing

Publishing to the Bitbucket Pipe registry is a release-time concern and is not
done as part of the build packaged in this directory. The `pipe.yml` manifest
in this directory carries the metadata the registry consumes.
