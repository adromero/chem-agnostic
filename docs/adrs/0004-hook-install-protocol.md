# ADR 0004 — `chemag install-hooks` protocol and the `--for-hook claude` mode

- Status: Accepted
- Date: 2026-05-01
- Stage: WP-010

## Context

WP-010 introduces `chemag install-hooks --tool <editor>` — a one-shot installer
that wires chemag's validation engine into AI-editor / agent hook systems.
Track 1 expands the tool list (Cursor, Codex, Aider, Cline, Copilot in
WP-011..WP-013); WP-010 lands the Claude Code path first because Claude Code
has the most concrete public hook API today.

Two design questions had to resolve before any code landed:

1. **How does the hook command line in `settings.json` know which file the
   model is about to edit?** Claude Code's hook API delivers this via a JSON
   envelope on stdin (under `tool_input.file_path`). There is **no
   `$CLAUDE_FILE_PATHS` env var** — early drafts of the spec mistakenly
   referenced one; it does not exist.
2. **Should the hook entry shell-out to a wrapper script, or call `chemag`
   directly?** A wrapper script means an extra moving part, a per-OS shebang,
   PATH dependence inside the editor's spawn environment, and a debugging
   surface no test covers. Calling `chemag` directly (with the hook data
   passed on stdin) keeps the contract one process deep.

## Decision

The installer writes one `chemag` invocation per hook event (PreToolUse +
PostToolUse) directly into `.claude/settings.json`. Both `chemag check-edit`
and `chemag analyze` learn a `--for-hook claude` flag that:

- Reads stdin JSON and extracts `tool_input.file_path`.
- Resolves the workspace from `--workspace` (the installer sets this to
  `$CLAUDE_PROJECT_DIR`, which Claude Code provides for hook invocations).
- Emits the appropriate Claude Code hook envelope on stdout.

The hook command line written to `settings.json` is exactly:

```
PreToolUse  Edit|Write   chemag check-edit --for-hook claude --format json --workspace "$CLAUDE_PROJECT_DIR"
PostToolUse Edit|Write   chemag analyze    --for-hook claude --format json --workspace "$CLAUDE_PROJECT_DIR"
```

In `--mode warn`, the PreToolUse command appends `--mode warn`; in
`--mode context-only` the PreToolUse entry is omitted entirely.

### Hook envelope shapes

PreToolUse — `chemag check-edit --for-hook claude` emits:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny" | "ask" | "allow",
    "permissionDecisionReason": "<diagnostic codes + remediation hints>"
  }
}
```

PostToolUse — `chemag analyze --for-hook claude` emits:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "<diagnostics summary>"
  }
}
```

PostToolUse **never** sets `permissionDecision` — by the time it runs the
tool has already executed. PostToolUse is informational only.

### Matchers

Matcher list is exactly `Edit|Write`. We do **not** include `MultiEdit` —
that name is sometimes assumed to be a Claude Code tool, but it is not.
Multi-file edits arrive as separate `Edit` calls, each triggering its own
PreToolUse hook.

### Modes

| Mode           | PreToolUse                           | PostToolUse |
| -------------- | ------------------------------------ | ----------- |
| `block` (default) | installed; deny on violation       | installed   |
| `warn`         | installed; ask (not deny) on violation | installed   |
| `context-only` | omitted                              | installed   |

### `_chemag: true` tag

Every chemag-installed hook entry carries `"_chemag": true`. We assume
Claude Code's settings parser tolerates unknown keys (it is a standard JSON
parser and the v1 documentation shows no schema rejection on extra fields).
The round-trip install/uninstall test (`claude-code.test.ts` →
`install/uninstall traceless round-trip`) verifies clean removal.

If a future Claude Code release ever rejected unknown keys, the installer
can move the tag to a sidecar file (`.claude/_chemag-managed.json`) without
touching the public CLI surface — `_settings-merge.ts` is the only place
that knows about the tag.

### `.bak` policy

`installClaudeCode` writes `<settings>.bak` exactly once — on the first
install run. Subsequent runs do not overwrite it. `--uninstall --restore`
copies `.bak` back over the live file. This pairs with the bigger guarantee:
`install → uninstall` is byte-traceless even without `--restore` (verified
by the round-trip test); the `.bak` exists to recover from out-of-band edits
the user made between install and uninstall.

### Scope (`--scope user` vs `--scope project`)

| Scope     | Path                                          |
| --------- | --------------------------------------------- |
| `project` | `<workspace>/.claude/settings.json`           |
| `user`    | `~/.claude/settings.json`                     |

Project scope is the default — most projects want chemag's hooks active for
collaborators on the same repo, not globally. User scope is for people who
keep chemag-managed projects on their machine and want one settings file.

### Fail-soft on parser errors

If the stdin JSON is malformed, or `tool_input.file_path` is missing:

- `check-edit --for-hook claude` (PreToolUse) emits
  `permissionDecision: "allow"` — never a deny. We never block real edits
  because of our parser bugs.
- `analyze --for-hook claude` (PostToolUse) emits **no** envelope (empty
  stdout). PostToolUse runs after the tool has executed — there is nothing
  to allow or deny.

Both cases write a one-line warning to stderr citing
`CHEM-INSTALL-HOOKS-006` so users can grep and report parser bugs.

## Manual sequence (rules + hooks)

The companion `chemag emit-rules --tool claude` (WP-009) writes
`CLAUDE.md` rule blocks; `chemag install-hooks --tool claude` writes the
runtime enforcement. Neither auto-runs the other — the docs site recommends:

```
chemag emit-rules --tool claude     # write rule files
chemag install-hooks --tool claude  # wire enforcement
```

Skipping the install-hooks step still gives the model the rules; skipping
emit-rules still gives runtime enforcement (the rules are advisory).

## Consequences

- The hook command line in `settings.json` is one `chemag` invocation —
  short, no shell scripts, no PATH ambiguity beyond the chemag binary
  itself (which is on PATH whenever the user installed chemag).
- Adding new editor / agent targets means adding installer modules (one per
  tool) that reuse the shared `_settings-merge.ts` and `_backup.ts`. No
  changes to the `--for-hook claude` semantics on the engine side because
  the host (Claude Code) is the only consumer of that mode.
- Future `--no-overwrite` flag (CHEM-INSTALL-HOOKS-003 is reserved for it)
  can land without renumbering codes; v1 simply re-writes idempotently.
- The shell-script companions (`scripts/chemag-pre-edit.sh`,
  `chemag-post-edit.sh`) are documentation/fallback only — `settings.json`
  points at the chemag binary directly.

## Alternatives considered

- **Wrapper shell script as the hook command.** Rejected: PATH ambiguity in
  the editor's spawn env, per-OS shebang concerns, an extra layer that no
  test covers.
- **Single `chemag hook` subcommand instead of two `--for-hook claude`
  flags.** Rejected: would duplicate workspace-loading + diagnostic-emission
  code that already lives in `check-edit` / `analyze`. The flag-based
  approach reuses the engine's caches and parser hooks unchanged.
- **`MultiEdit` matcher.** Rejected: not a real Claude Code tool. Adding it
  would either no-op (no harm but confusing) or fire on a future
  hypothetical tool with the same name in unpredictable ways.
- **Storing `_chemag: true` in a sidecar file from day one.** Rejected as
  premature optimisation — the inline tag is simpler and the sidecar fallback
  is documented above.
