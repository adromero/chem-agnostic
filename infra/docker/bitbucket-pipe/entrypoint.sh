#!/bin/sh
# ---------------------------------------------------------------------------
# chemag — Bitbucket Pipe entrypoint.
#
# Runs chemag against the workspace mounted at $BITBUCKET_CLONE_DIR (Bitbucket
# Pipelines default), then posts a sticky PR comment via `chemag ci
# bitbucket`. The CLI's poster reads BITBUCKET_TOKEN, BITBUCKET_REPO_FULL_NAME
# and BITBUCKET_PR_ID from the env (Pipelines sets the latter two
# automatically on PR pipelines; the token is a repository secret).
#
# We deliberately don't gate the comment-post on chemag's exit code: a non-
# zero chemag run still has diagnostics worth surfacing on the PR. The pipe's
# own exit code matches chemag's, so the pipeline still fails on real
# violations.
# ---------------------------------------------------------------------------

set -eu

WORKSPACE_FILE="${CHEMAG_WORKSPACE:-workspace.yaml}"

# `chemag check` may exit non-zero on violations; we still want the JSON so we
# can post a comment. Capture exit code, hand the JSON to the poster, then
# exit with the original code.
DIAG_FILE="$(mktemp -t chemag-diag-XXXXXX.json)"
trap 'rm -f "$DIAG_FILE"' EXIT

set +e
chemag check "$WORKSPACE_FILE" --format json > "$DIAG_FILE"
CHECK_EXIT=$?
set -e

chemag ci bitbucket --input "$DIAG_FILE"

exit "$CHECK_EXIT"
