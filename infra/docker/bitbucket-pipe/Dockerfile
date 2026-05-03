# ---------------------------------------------------------------------------
# chemag — Bitbucket Pipe image.
#
# Bitbucket Pipes are containerised steps consumers reference from their
# bitbucket-pipelines.yml. This image bundles the chemag CLI and a thin shell
# entrypoint that runs `chemag check --format json` and pipes the result into
# `chemag ci bitbucket` to post (or update) a sticky PR comment.
#
# We pin to a specific Node minor + npm-install chemag from the public
# registry. The CLI's own Bitbucket-poster is in `packages/cli/src/ci/
# bitbucket.ts` — see that module for the env-var contract Bitbucket
# Pipelines is expected to populate (BITBUCKET_TOKEN,
# BITBUCKET_REPO_FULL_NAME, BITBUCKET_PR_ID).
# ---------------------------------------------------------------------------

FROM node:22-alpine

# --no-fund / --no-audit keep the build log tidy in pipe runs.
RUN npm install --global --no-fund --no-audit @chemag/cli@latest

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
