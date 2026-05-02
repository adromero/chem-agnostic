# chemag-pr.yml managed by chemag install-hooks
#
# This workflow is regenerated whenever `chemag install-hooks --tool copilot`
# runs against this repository. The leading comment line above is the
# chemag-managed header that the installer uses to detect previous runs and
# refuse to overwrite hand-authored workflows. If you need to customise the
# CI behavior, drop the header line and the installer will leave the file
# alone (you'll need to re-add chemag check / analyze invocations yourself).

name: chemag-pr

on:
  pull_request:
    branches: [main]

concurrency:
  group: chemag-pr-${{ github.ref }}
  cancel-in-progress: true

jobs:
  chemag:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Install chemag
        run: npm install --global chemag

      - name: chemag check
        run: chemag check workspace.yaml --format human

      - name: chemag analyze
        run: chemag analyze workspace.yaml --format human
