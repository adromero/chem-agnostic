# chemag — GitLab CI template

Drop-in `.gitlab-ci.yml` include that runs the [chemag](https://github.com/adromero/chem-agnostic) CLI on every merge request and on the default branch, posts a sticky MR comment with the violations table, and feeds JUnit XML to GitLab's native MR widget.

## Quick start

Add the include to your `.gitlab-ci.yml`:

```yaml
include:
  - remote: 'https://chemag.dev/ci/gitlab.yml'

stages:
  - test
```

Set the `GITLAB_TOKEN` CI/CD variable (Project → Settings → CI/CD → Variables) to a personal access token with `api` scope — or use the project's [job token](https://docs.gitlab.com/ee/ci/jobs/ci_job_token.html) (`$CI_JOB_TOKEN`) once your project allows token-scoped access.

That's it. The next merge request pipeline will:

1. Install `@chemag/cli`.
2. Run `chemag check`, emit JUnit XML.
3. Post or update a sticky chemag comment on the MR.
4. Upload `junit.xml` so GitLab's MR widget shows the per-suite breakdown.

## Required environment

| Variable | Source | Notes |
|---|---|---|
| `GITLAB_TOKEN` | You set it | `api` scope. Mark it Masked in the CI/CD Variables UI. |
| `CI_PROJECT_ID` | GitLab | Provided automatically. |
| `CI_MERGE_REQUEST_IID` | GitLab | Set on `merge_request_event` pipelines only. |
| `CI_API_V4_URL` | GitLab | Optional; defaults to `https://gitlab.com/api/v4`. Self-hosted instances usually have this set already. |

## Pinning a chemag version

Override `CHEMAG_VERSION` in your project's CI/CD variables (or directly in your `.gitlab-ci.yml`):

```yaml
include:
  - remote: 'https://chemag.dev/ci/gitlab.yml'

variables:
  CHEMAG_VERSION: "0.1.0"
```

## Sticky comment behaviour

Each chemag-managed comment carries a hidden HTML sentinel (`<!-- chemag:comment -->`) on its first line. On every pipeline run the poster looks for an existing note with that sentinel and updates it in place; if there isn't one it creates a new note. The result: one comment per MR, always reflecting the latest pipeline.

The same sentinel is shared with the chemag GitHub Action — comments stay byte-stable across releases so updating chemag never orphans an existing thread.

## Customising the job

The bundled job is intentionally minimal so you can override pieces in your own `.gitlab-ci.yml`:

```yaml
chemag-check:
  image: my-mirror/node:22-alpine
  before_script:
    - !reference [chemag-check, before_script]
    - my-corp-bootstrap
```

Override `script:` entirely if you need to run multiple chemag invocations or add custom assertions on the JSON envelope before the comment is posted.
