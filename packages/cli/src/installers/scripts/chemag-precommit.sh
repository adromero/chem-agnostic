#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# chemag-precommit.sh — canonical pre-commit content used by the Cursor
# installer (and later: any tool whose installer wires a husky pre-commit).
#
# `chemag install-hooks --tool cursor` does NOT copy this file into the
# project's `.husky/pre-commit` — it appends a single tagged line that
# matches `CHEMAG_PRECOMMIT_LINE` exported from `_husky.ts`. This file
# exists as a hand-runnable companion and as a documentation reference for
# the line shape.
#
# Idempotent: every invocation runs `chemag check` once, exits non-zero on
# any diagnostic. No filesystem mutations of its own.
# ---------------------------------------------------------------------------

set -euo pipefail

chemag check --format human || exit 1
