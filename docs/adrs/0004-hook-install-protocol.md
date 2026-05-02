# ADR 0004 — `chemag install-hooks` protocol and the `--for-hook claude` mode

- Status: Accepted
- Date: 2026-05-01 (revised 2026-05-02 for WP-011 — Cursor installer; revised
  2026-05-03 for WP-012 — Codex installer + tool-agnostic husky diagnostic)
- Stage: WP-010, WP-011, WP-012

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

## Cursor (WP-011)

Cursor has no deterministic editor-side hook API today, so the "install"
surface for `chemag install-hooks --tool cursor` is three artifacts, not one
settings file:

| Artifact                              | Tagging mechanism                          |
| ------------------------------------- | ------------------------------------------ |
| `.husky/pre-commit`                   | Trailing line comment `# _chemag`          |
| `.cursor/rules/architecture.mdc`      | `<!-- chemag:rules:start --> ... -->` (rules markers, owned by `emit-rules`) |
| `CONTRIBUTING.md`                     | `<!-- chemag:contributing:start --> ... -->` block markers |

Each artifact is line-tagged (shell) or marker-block-tagged (markdown), so
no `.bak` file is required — `_backup.ts` is **not** consumed by the
Cursor installer.

### Husky detection (CHEM-INSTALL-HOOKS-007)

Detection is satisfied if **either** of:

- `package.json` declares `husky` in `dependencies`, `devDependencies`, or
  `peerDependencies`, **or**
- `.husky/` already exists at the workspace root.

If neither is true, the installer fails with **CHEM-INSTALL-HOOKS-007**
`husky_not_detected` and prints the actionable remedy
(`pnpm add -D husky && pnpm husky init`). The trKey is intentionally
**tool-agnostic** as of WP-012 — both the Cursor and Codex installers (and
WP-013's Aider/Cline/Copilot installers) throw the same
`HuskyNotDetectedError`, surface the same code, and render the same
message. Detection is intentionally permissive — `pnpm husky init` creates
`.husky/` even before husky is pinned into `dependencies` on a fresh
checkout, and we want to support the "husky already initialised but not yet
in package.json" intermediate state.

### Pre-commit unparseable (CHEM-INSTALL-HOOKS-008)

If `.husky/pre-commit` already exists but cannot be safely modified —
binary content (NUL bytes), multiple chemag-tagged lines pointing at
different commands, or a chemag tag on an empty-command line — the
installer fails with **CHEM-INSTALL-HOOKS-008** `cursor_precommit_unparseable`
and **does not modify the file**. The user resolves the conflict by hand
(or by deleting `.husky/pre-commit`) before re-running.

### The 5-step library flow for `.cursor/rules/architecture.mdc`

The Cursor installer is a sibling of `cmdEmitRules`, not a caller of it.
`cmdEmitRules` is the CLI entry point for `chemag emit-rules` — it parses
argv, emits telemetry, and translates errors into exit codes. Calling it
from another command would be the wrong abstraction level (one CLI command
invoking another's argv parser).

Instead, `installCursor` performs the same library-level work that
`cmdEmitRules` does for `--tool cursor`, in five explicit steps:

1. `loadWorkspace(workspace.yaml)` — parse the manifest.
2. `discoverCompounds(workspace, root, { loadCompound })` — enumerate
   compound manifests on disk. On failure: log a warning, continue with an
   empty list (matches `cmdEmitRules` behavior).
3. `buildRulesContent(workspace, compounds)` — build the language-agnostic
   intermediate.
4. `emitCursorMdc(content)` — content-only emitter. Returns an
   `EmittedFile` with `path`, `block`, `leading`, `trailing`, `body`,
   `warnings`. Does NOT load workspaces. Does NOT touch disk.
5. `mergeBetweenMarkers(existing, file.block, { isMdc: true, leading,
   trailing, overwrite: false })` to produce the merged body, then write to
   disk (or skip the write under `--dry-run`).

A regression test (`cursor.test.ts` → "5-step flow parity") asserts that
the installer's MDC output is byte-identical to a fresh
`chemag emit-rules --tool cursor` run on the same workspace. This is the
contract that pins the two paths together.

### Cursor uninstall policy

`uninstallCursor`:

- **Removes** every `# _chemag`-tagged line from `.husky/pre-commit`. The
  file is deleted only when the strip leaves only the default shebang (or
  whitespace) behind; otherwise the file is kept in place.
- **Removes** the chemag block from `CONTRIBUTING.md` (between the
  `chemag:contributing` markers). The file is deleted only when chemag
  was its sole author (no manual content survives).
- **Does NOT delete** `.cursor/rules/architecture.mdc`. Deletion is opt-in:
  the user can hand-remove the file or run `chemag emit-rules --tool cursor`
  again to refresh it. Rationale: the MDC is the AI-context layer that the
  developer is most likely to want to keep around, and the installer's
  responsibility is the deterministic gate (the husky line) plus the doc
  fragment (CONTRIBUTING.md). The MDC's own idempotence markers make it
  trivially regenerable on demand.

### Modes for Cursor

Cursor has no deterministic editor hook beyond the husky pre-commit, so
the `--mode block|warn|context-only` flag (which controls the Claude Code
PreToolUse downgrade behavior) is **accepted but ignored** for
`--tool cursor`. The installer surfaces an informational note in the
summary when a non-default mode is passed, but no behavior changes.

`--scope user|project` is similarly informational-only — husky is always
project-scoped (lives at `<workspace>/.husky/pre-commit`). User-scope
makes no sense for a per-repo pre-commit gate.

`--restore` is rejected outright for Cursor: there is no `.bak` file to
restore from. Users who want to undo the install run
`chemag install-hooks --tool cursor --uninstall`.

## Codex (WP-012)

Codex (OpenAI's coding agent) reads `AGENTS.md` at the workspace root by
convention, so the install surface for `chemag install-hooks --tool codex`
is two artifacts:

| Artifact            | Tagging mechanism                                          |
| ------------------- | ---------------------------------------------------------- |
| `.husky/pre-commit` | Trailing line comment `# _chemag`                          |
| `AGENTS.md`         | `<!-- chemag:rules:start --> ... -->` (rules markers, owned by `emit-rules`) |

Each artifact is line-tagged (shell) or marker-block-tagged (markdown), so
no `.bak` file is required — `_backup.ts` is **not** consumed by the Codex
installer. The husky pre-commit line is byte-identical to the Cursor
installer's: `chemag check --format human || exit 1 # _chemag`.

### Husky-missing diagnostic is tool-agnostic

WP-012 renames `CHEM-INSTALL-HOOKS-007`'s trKey from
`diagnostic.cursor_husky_not_detected` to the tool-agnostic
`diagnostic.husky_not_detected`. The rendered message names neither
"cursor" nor "codex" — both installers (and the Aider/Cline/Copilot
installers in WP-013) reuse the same diagnostic without further key churn.
The code number (007) is unchanged.

### MCP-registration follow-up tip (cross-references WP-017)

After a successful Codex install, the CLI prints a follow-up tip rendered
via `tr("cli.install_hooks.tip.mcp_register", { clientName, clientId })`.
The tip points users at `chemag mcp install --client codex` (the surface
landing in WP-017). The tip is **text-only** — `install-hooks --tool codex`
does NOT auto-register the MCP server today; that responsibility belongs
to WP-017. Leaving the tip as a `tr()` string lets WP-017 swap the message
text without rewriting this installer or churning the key.

### The 5-step library flow for `AGENTS.md`

The Codex installer is a sibling of `cmdEmitRules`, not a caller of it.
`installCodex` performs the same library-level work that `cmdEmitRules`
does for `--tool codex`, in five explicit steps (mirroring the Cursor
installer):

1. `loadWorkspace(workspace.yaml)` — parse the manifest.
2. `discoverCompounds(workspace, root, { loadCompound })` — enumerate
   compound manifests on disk. On failure: log a warning, continue with an
   empty list (matches `cmdEmitRules` behavior).
3. `buildRulesContent(workspace, compounds)` — build the language-agnostic
   intermediate.
4. `emitAgentsMd(content)` — content-only emitter. Returns an
   `EmittedFile` with `path`, `block`, `leading`, `trailing`, `body`,
   `warnings`. Does NOT load workspaces. Does NOT touch disk.
5. `mergeBetweenMarkers(existing, file.block, { isMdc: false, leading,
   trailing, overwrite: false })` to produce the merged body, then write
   to disk (or skip the write under `--dry-run`).

A regression test (`codex.test.ts` → "5-step flow parity") asserts that
the installer's AGENTS.md output is byte-identical to a fresh
`chemag emit-rules --tool codex` run on the same workspace. This is the
contract that pins the two paths together.

### Codex uninstall policy

`uninstallCodex`:

- **Removes** every `# _chemag`-tagged line from `.husky/pre-commit`. The
  file is deleted only when the strip leaves only the default shebang (or
  whitespace) behind; otherwise the file is kept in place.
- **Does NOT delete** `AGENTS.md`. Deletion is opt-in: the user can
  hand-remove the file or run `chemag emit-rules --tool codex` again to
  refresh it. Rationale: AGENTS.md is the AI-context layer the developer
  is most likely to want to keep around; the installer's responsibility is
  the deterministic gate (the husky line). The marker-block tagging makes
  AGENTS.md trivially regenerable on demand.

### Modes for Codex

Codex has no deterministic editor hook beyond the husky pre-commit, so the
`--mode block|warn|context-only` flag is **accepted but ignored** for
`--tool codex` (mirrors Cursor). The installer surfaces an informational
note in the summary when a non-default mode is passed.

`--scope user|project` is similarly informational-only — husky is always
project-scoped.

`--restore` is rejected outright for Codex: there is no `.bak` file to
restore from. Users who want to undo the install run
`chemag install-hooks --tool codex --uninstall`.
