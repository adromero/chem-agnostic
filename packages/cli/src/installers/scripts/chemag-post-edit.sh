#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# chemag-post-edit.sh — fallback wrapper for Claude Code's PostToolUse hook.
#
# Companion to chemag-pre-edit.sh. settings.json normally calls `chemag analyze`
# directly; this wrapper exists so users can intercept the call (custom log
# routing, metrics, etc.) without losing the hook envelope shape.
#
# Reads the Claude Code hook envelope on stdin and forwards it to
# `chemag analyze --for-hook claude`, which emits `additionalContext` for the
# model — never `permissionDecision: "deny"` (PostToolUse is informational).
# ---------------------------------------------------------------------------

set -euo pipefail

WORKSPACE="${CLAUDE_PROJECT_DIR:-$PWD}"

exec chemag analyze --for-hook claude --format json --workspace "$WORKSPACE"
