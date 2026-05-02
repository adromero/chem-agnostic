#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# chemag-pre-edit.sh — fallback wrapper for Claude Code's PreToolUse hook.
#
# settings.json normally invokes `chemag check-edit --for-hook claude` directly.
# This script is a hand-runnable companion for users who want to wrap the call
# (for example, in extra logging or environment scrubbing). It is NOT executed
# by chemag's installer — running `chemag install-hooks --tool claude` writes
# the chemag binary path into settings.json directly.
#
# Reads the Claude Code hook envelope on stdin (JSON) and forwards it to
# `chemag check-edit --for-hook claude`, which extracts `tool_input.file_path`
# and emits the PreToolUse decision envelope on stdout.
#
# Idempotent: every invocation reads stdin once, calls chemag once, and exits
# with chemag's exit code. No filesystem mutations of its own.
# ---------------------------------------------------------------------------

set -euo pipefail

# `$CLAUDE_PROJECT_DIR` is set by Claude Code when invoking hooks.
# Fall back to the cwd if it is somehow missing (defensive — Claude Code 1.x+
# always sets it for hook invocations).
WORKSPACE="${CLAUDE_PROJECT_DIR:-$PWD}"

exec chemag check-edit --for-hook claude --format json --workspace "$WORKSPACE"
