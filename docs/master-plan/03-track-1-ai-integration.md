# Track 1 — AI-Agent Integration (WP-009 through WP-018)

The strategic core of the product. Track 1 turns chem-ag from "a CLI you remember to run" into "a guard rail your agents can't bypass."

## Sequencing within track

```
WP-009 ─→ WP-010 (Claude Code) ──┐
   ↓                              ├─→ WP-018 (reference monorepo) ─→ Track 5 (benchmarks)
   ├─→ WP-011 (Cursor) ──────────┤
   ├─→ WP-012 (Codex) ───────────┤
   └─→ WP-013 (Aider/Cline) ─────┘

WP-014 ─→ WP-015 ─→ WP-016 ─→ WP-017
(MCP scaffold)  (tools)  (resources)  (registration)
```

WP-009 (emit-rules) must complete before any of WP-010..WP-013 (each calls into emit-rules). The MCP track (WP-014..WP-017) runs in parallel with hooks.

---

## WP-009 — `emit-rules` subcommand

**Track:** 1
**Effort:** L
**Depends on:** WP-002 (vocabulary), WP-007 (codes)
**Blocks:** WP-010..WP-013

### Description

`chemag emit-rules` generates compact, AI-editor-friendly rule files from `workspace.yaml` and per-compound manifests. Output formats: AGENTS.md, CLAUDE.md, .cursor/rules/architecture.mdc, .github/copilot-instructions.md, .aider/CONVENTIONS.md, .clinerules.

Each emitted file is ≤80 lines (per ETH study findings cited in `00-overview.md`). Detailed rules live in the cloud-hosted MCP server or full docs; the rule files contain only what an agent must know up-front.

### Files to create

- `packages/cli/src/commands/emit-rules.ts`
- `packages/core/src/rules-emitters/`
  - `agents-md.ts`
  - `claude-md.ts` (refactor of existing `template-claude-md.ts`)
  - `cursor-mdc.ts`
  - `copilot-instructions.ts`
  - `aider-conventions.ts`
  - `cline-rules.ts`
  - `index.ts` — dispatcher and shared content builder.
- Snapshot test fixtures in `packages/core/test/rules-emitters/`.

### CLI surface

```
chemag emit-rules [options]

Options:
  --tool <claude|cursor|codex|copilot|aider|cline|all>   default: all
  --workspace <path>                                      default: ./workspace.yaml
  --out-dir <path>                                        default: workspace root
  --max-lines <n>                                         default: 80
  --include-violations                                    embed current violations as "fix me" hints
  --dry-run                                               print what would be written
  --diff                                                  print a unified diff against existing files
```

### Output structures

#### AGENTS.md (the standard)

Sections:
1. Introduction (1 paragraph): "This project uses chem-ag architecture rules. Read this file in full before editing code."
2. Architecture summary (≤6 lines): names roles, names compound types, links to compound manifest convention.
3. Dependency rules table (1 row per role).
4. Cross-module rule (1 sentence).
5. Tooling: `chemag check-edit <file>` blocks bad edits; `chemag mcp` exposes structured queries.
6. Where to look: list each compound by name, one line each.

Total: <80 lines.

#### CLAUDE.md (existing, refactored)

Combines the AGENTS.md content with Claude-specific guidance: hook expectations, MCP tool names. Keep the "Rules for AI Assistants" section. Refactored to reuse content builders from AGENTS.md to avoid drift.

#### .cursor/rules/architecture.mdc

YAML frontmatter:
```mdc
---
description: Architecture rules for this codebase
globs: ["**/*.{ts,tsx,py,go}"]
alwaysApply: true
---
```

Body: same as AGENTS.md but condensed further (≤60 lines), with a final block:
```
Before editing, run: chemag check-edit <path-to-file>
If it returns violations, do not commit the change.
```

#### .github/copilot-instructions.md

Even more compact (≤40 lines). Copilot's context budget is tight.

#### .aider/CONVENTIONS.md

Aider-specific format. Same content shape; ends with a `## Aider behavior` section asking the agent to invoke `chemag check-edit` before sending diffs.

#### .clinerules

Cline reads any `.clinerules` file; same content shape.

### Idempotence and merge behavior

- Each emitted file is written with two markers: `<!-- chemag:rules:start -->` and `<!-- chemag:rules:end -->`.
- On subsequent runs, only content between these markers is replaced. Manual additions outside are preserved.
- For .mdc and other YAML-frontmatter files, the markers go inside the body section.
- If markers absent and file exists: error unless `--overwrite`.

### Tests

- Snapshot tests for each emitter under each vocabulary.
- Idempotence: emit twice, compare — files identical.
- Merge: pre-write a file with manual additions outside markers, emit, verify additions preserved.
- Line-count budget enforced.

### Acceptance criteria

- [ ] All 6 emitters produce valid output for the reference workspace.
- [ ] Re-running `emit-rules` is a no-op when nothing changed.
- [ ] Manual edits outside the markers are preserved across re-emits.
- [ ] Each format snapshot-tested for both vocabularies.
- [ ] Documentation page in docs site for each emitter.
- [ ] `--include-violations` injects current violations into the body as hint comments.

---

## WP-010 — `install-hooks` for Claude Code

**Track:** 1
**Effort:** L
**Depends on:** WP-004 (check-edit), WP-009 (emit-rules)
**Blocks:** WP-018, WP-047 (benchmark needs this to test hook behavior)

### Description

`chemag install-hooks --tool claude` configures Claude Code to invoke `chemag check-edit` before/after every Edit and Write tool call. Blocking on bond-rule violations is the deterministic enforcement mechanism that no `.cursor/rules` or AGENTS.md can match.

### Files to create

- `packages/cli/src/commands/install-hooks.ts`
- `packages/cli/src/installers/claude-code.ts`
- `packages/cli/src/installers/_settings-merge.ts` — JSON merge utility for tool settings files.
- `packages/cli/src/installers/scripts/chemag-pre-edit.sh` — invokable hook script (templated).
- `packages/cli/src/installers/scripts/chemag-post-edit.sh`
- Tests in `packages/cli/test/installers/`.

### CLI surface

```
chemag install-hooks --tool <claude|cursor|codex|aider|cline|all>
                     [--scope user|project]                       default: project
                     [--mode block|warn|context-only]             default: block
                     [--dry-run]
```

### What it does for Claude Code

Adds entries to `.claude/settings.json` (project scope) or `~/.claude/settings.json` (user scope):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "chemag check-edit \"$CLAUDE_TOOL_INPUT_FILE\" --content \"$CLAUDE_TOOL_INPUT_CONTENT_FD\" --format json --workspace \"$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "chemag analyze --changed-only \"$CLAUDE_TOOL_INPUT_FILE\" --format json --workspace \"$CLAUDE_PROJECT_DIR\""
          }
        ]
      }
    ]
  }
}
```

The hook script returns `permissionDecision: "deny"` with a structured message when violations are present. The chemag CLI emits the JSON the hook expects on stderr/stdout per the Claude Code spec.

### Mode behavior

- `block`: PreToolUse returns deny on errors. PostToolUse returns nothing (just informational; the agent reads stdout).
- `warn`: PreToolUse never denies; both hooks emit informational messages. Useful for first deploys.
- `context-only`: only PostToolUse is installed. PreToolUse is omitted. Falls back to passive feedback.

### Settings merge

`_settings-merge.ts` reads existing `.claude/settings.json`, merges the chemag entries, writes back. Key behaviors:

- If existing hooks for the same matcher exist, append (don't replace).
- Tag chemag's entries with `"_chemag": true` for safe removal.
- Idempotence: rerunning produces no diff.
- Backup: write `.claude/settings.json.bak` on first install.

### Uninstall

```
chemag install-hooks --tool claude --uninstall
```

Removes all entries tagged `"_chemag": true`. Restores from `.bak` if `--restore`.

### Tests

- Idempotence (install twice).
- Coexistence with pre-existing hooks (none corrupted).
- Each mode produces correct settings.json.
- Uninstall removes only chemag entries.
- Hook scripts produce valid JSON for Claude Code's expected schema.
- Integration test: spawn `chemag check-edit` with synthetic input and verify the JSON envelope it emits matches Claude Code's hook protocol.

### Acceptance criteria

- [ ] After `install-hooks --tool claude`, a Claude Code session is configured.
- [ ] Manual end-to-end test (operator runs Claude Code in the reference repo, attempts a forbidden edit, sees it blocked) recorded as asciinema and committed under `apps/marketing/public/demos/`.
- [ ] Uninstall is clean.
- [ ] Hook script handles edge cases: file outside workspace (silent pass), unparseable content (warning, no block), multi-file MultiEdit (loops and aggregates).

---

## WP-011 — `install-hooks` for Cursor

**Track:** 1
**Effort:** M
**Depends on:** WP-009, WP-010 (shares installer infrastructure)
**Blocks:** WP-018

### Description

Cursor doesn't have deterministic hooks. The "install" for Cursor is:
1. Write `.cursor/rules/architecture.mdc` (already covered by `emit-rules`).
2. Add a pre-commit hook (via husky) that runs `chemag check`.
3. Configure a Cursor-CLI-friendly wrapper script that the user can bind to a command palette entry.

### Files to create

- `packages/cli/src/installers/cursor.ts`
- `packages/cli/src/installers/scripts/chemag-precommit.sh`

### Behavior

- Detects whether `husky` is installed; if not, prints instructions.
- Installs `.husky/pre-commit` hook calling `chemag check --format human` and failing the commit on errors.
- Adds `.cursor/rules/architecture.mdc` (re-uses `emit-rules`).
- Writes a CONTRIBUTING.md fragment instructing developers to run `chemag check-edit` manually for fast feedback.

### Acceptance criteria

- [ ] After install, a forbidden edit fails the pre-commit hook.
- [ ] Re-runnable; doesn't double-add hooks.
- [ ] Documentation page for Cursor integration.

---

## WP-012 — `install-hooks` for Codex / OpenAI

**Track:** 1
**Effort:** S
**Depends on:** WP-009
**Blocks:** WP-018

### Description

For Codex (which standardizes on AGENTS.md), the install is:
1. Emit AGENTS.md.
2. Add a pre-commit hook (same as Cursor) for the deterministic gate.
3. Optionally register the MCP server (cross-references WP-017).

### Files to create

- `packages/cli/src/installers/codex.ts`

### Acceptance criteria

- [ ] Idempotent.
- [ ] Documented.

---

## WP-013 — `install-hooks` for Aider, Cline, Copilot

**Track:** 1
**Effort:** M
**Depends on:** WP-009
**Blocks:** WP-018

### Description

One installer file per tool, sharing the rules-emitter outputs:

- **Aider**: `.aider/CONVENTIONS.md` + pre-commit hook + a `.aider.conf.yml` snippet that adds `chemag` as an `auto-commands` runner.
- **Cline**: `.clinerules` + pre-commit hook + an MCP server registration (Cline supports MCP).
- **Copilot**: `.github/copilot-instructions.md` + pre-commit hook + GitHub Action for PR-level enforcement (cross-ref WP-023).

### Files to create

- `packages/cli/src/installers/aider.ts`
- `packages/cli/src/installers/cline.ts`
- `packages/cli/src/installers/copilot.ts`

### Acceptance criteria

- [ ] Each installer produces correct artifacts on a clean fixture repo.
- [ ] Each documented.
- [ ] Each tested for idempotence.

---

## WP-014 — MCP server scaffold

**Track:** 1
**Effort:** M
**Depends on:** WP-001, WP-002, WP-003
**Blocks:** WP-015, WP-016, WP-017

### Description

Stand up the chemag MCP server using `@modelcontextprotocol/sdk`. Stdio transport (most universal). HTTP+SSE transport optional in v1.0.x for cloud-hosted use cases.

### Files to create

- `packages/mcp-server/package.json`
- `packages/mcp-server/src/server.ts` — main entry.
- `packages/mcp-server/src/transport.ts` — stdio + SSE.
- `packages/mcp-server/src/context.ts` — per-session state (workspace path, vocabulary, cache).
- `packages/mcp-server/src/protocol.ts` — JSON-RPC envelope helpers.
- `packages/mcp-server/test/server.test.ts`
- `packages/cli/src/commands/mcp.ts` — invokes the MCP server (`chemag mcp [--workspace] [--transport stdio|sse]`).

### Server identity

- `name`: `chemag`
- `version`: from package.json
- `protocolVersion`: latest MCP version supported
- `capabilities`: `{ tools: {}, resources: { subscribe: true }, prompts: {} }`

### Initialization

On `initialize`, the client may pass:
- `workspaceUri`: file:// URI to workspace root or workspace.yaml
- `vocabulary`: "standard" | "chemistry"
- `clientName`: e.g. "claude-code"

The server resolves the workspace, loads via cache, and stores state per-session.

### Tests

- Initialize handshake.
- Vocabulary param respected (tool descriptions and error messages reflect it).
- Session isolation (two sessions can target two workspaces).
- Graceful shutdown on EOF.

### Acceptance criteria

- [ ] `chemag mcp` runs as a stdio MCP server.
- [ ] `claude mcp add chemag chemag mcp --workspace /path/to/repo` registers it for Claude Code.
- [ ] Inspector tool from MCP project reports server health.
- [ ] No memory leaks across 100 sequential tool calls (verified by a long-running test).

---

## WP-015 — MCP tools

**Track:** 1
**Effort:** L
**Depends on:** WP-004, WP-014
**Blocks:** WP-018

### Description

Implement the tool surface that AI agents call. Tools return structured JSON the agent uses to plan or correct.

### Files to create

- `packages/mcp-server/src/tools/where-should-this-go.ts`
- `packages/mcp-server/src/tools/validate-edit.ts`
- `packages/mcp-server/src/tools/list-compounds.ts`
- `packages/mcp-server/src/tools/get-compound.ts`
- `packages/mcp-server/src/tools/get-bond-rules.ts`
- `packages/mcp-server/src/tools/find-violations.ts`
- `packages/mcp-server/src/tools/explain-diagnostic.ts`
- `packages/mcp-server/src/tools/scaffold-unit.ts`
- `packages/mcp-server/src/tools/index.ts` — registry.
- Tests per tool.

### Tool specs (input/output schemas)

#### `where_should_this_go`

```ts
input: { description: string; intent_hint?: "domain"|"infrastructure"|"workflow"|"contract" }
output: {
  suggestions: Array<{
    compound: string;
    role: string;
    confidence: number; // 0-1
    rationale: string;
    nearest_existing_units: Array<{ name: string; file: string }>;
  }>;
}
```

Implementation: keyword matching against compound descriptions + role definitions, weighted by existing unit semantics. Uses simple TF-IDF for v1.0; cloud version (WP-040+) can use embeddings.

#### `validate_edit`

```ts
input: { file: string; new_content?: string; proposed_role?: string; proposed_compound?: string }
output: {
  valid: boolean;
  diagnostics: Diagnostic[]; // shared schema
  remediation?: { kind: string; ...kind-specific fields }
}
```

Wraps `check-edit`.

#### `list_compounds`

```ts
input: { type?: "compound"|"reagent"|"solvent"|"catalyst" }
output: {
  compounds: Array<{
    name: string; type: string; description?: string;
    public_surface_path: string;
    roles_present: string[];
    units_count: number;
  }>;
}
```

#### `get_compound`

```ts
input: { name: string }
output: {
  name: string; type: string; description?: string;
  manifest_path: string;
  exports: Record<string, string[]>;
  imports: ImportDeclaration[];
  units: UnitDeclaration[];
  signals?: CompoundSignals;
  graph_subgraph_mermaid: string; // local Mermaid subgraph
}
```

#### `get_bond_rules`

```ts
input: { vocabulary?: "standard"|"chemistry" }
output: {
  roles: Record<string, { description: string; folder: string }>;
  bonds: Record<string, string[]>;
  compound_types: Record<string, ...>;
  cross_compound_rule: "public_only"|"unrestricted";
}
```

#### `find_violations`

```ts
input: { since?: string /* git ref */; compound?: string /* filter */ }
output: { diagnostics: Diagnostic[]; total: number; truncated: boolean }
```

If `since` provided, runs analyze on changed files only.

#### `explain_diagnostic`

```ts
input: { code: string }
output: { code: string; description: string; level: string; doc_url: string; examples: string[] }
```

#### `scaffold_unit`

```ts
input: { compound: string; role: string; name: string; export?: boolean; implements?: string }
output: { created: string[]; manifest_diff: string }
```

Wraps existing `chemag add unit` logic. Returns the new file paths and the unified diff applied to compound.yaml.

### Tests

- Each tool has a fixture-backed test asserting input → output.
- Schema validation on every input (zod).
- Tool descriptions in the registry are short, agent-friendly, and snapshot-tested.

### Acceptance criteria

- [ ] All 8 tools work end-to-end via MCP Inspector.
- [ ] `validate_edit` returns within 200ms warm.
- [ ] `where_should_this_go` produces non-trivial suggestions on the reference monorepo.
- [ ] All inputs validated; bad input returns structured MCP errors, never crashes.

---

## WP-016 — MCP resources + subscriptions

**Track:** 1
**Effort:** M
**Depends on:** WP-014, WP-015
**Blocks:** WP-018

### Description

Expose the architecture as MCP resources so agents can `resources/read` rather than tool-call for static data. Subscribe-able so clients get push updates when manifests change.

### Resources

- `architecture://workspace` — full workspace.yaml as JSON.
- `architecture://compound/{name}` — full compound manifest as JSON.
- `architecture://compound/{name}/public-surface` — list of public exports.
- `architecture://violations` — current violations (refreshed on subscription).
- `architecture://graph.mermaid` — full Mermaid graph.
- `architecture://docs/{section}` — markdown sections of the rules (roles, bonds, etc.) for inline display by the agent.

### Subscriptions

- File watcher on `workspace.yaml` and `**/compound.yaml`.
- On change, server emits `notifications/resources/updated` for affected URIs.
- Cache (WP-003) is invalidated for the changed manifests.

### Files to create

- `packages/mcp-server/src/resources/`
  - `workspace.ts`
  - `compound.ts`
  - `violations.ts`
  - `graph.ts`
  - `docs.ts`
  - `index.ts`
- `packages/mcp-server/src/watcher.ts` — chokidar-based watcher.
- Tests.

### Acceptance criteria

- [ ] All resources readable via MCP Inspector.
- [ ] Editing workspace.yaml fires update notifications.
- [ ] `subscribe` and `unsubscribe` work correctly.
- [ ] Graceful handling of missing workspaces (returns MCP error, not crash).

---

## WP-017 — MCP registration helpers

**Track:** 1
**Effort:** S
**Depends on:** WP-014
**Blocks:** none

### Description

Convenience commands to register the MCP server with each major client. Reduces "MCP server install friction" — a documented adoption pain point.

### Files to create

- `packages/cli/src/commands/mcp-install.ts`
- Per-client adapters in `packages/cli/src/installers/mcp/{claude,cursor,cline,...}.ts`.

### CLI surface

```
chemag mcp install --client <claude|cursor|cline|continue|all>
                   [--scope user|project]
                   [--workspace <path>]
chemag mcp uninstall --client ...
chemag mcp status     # list installations across clients
```

### What it does for Claude Code

- Runs `claude mcp add chemag -- chemag mcp --workspace "$PWD"` if `claude` CLI is on PATH.
- Else writes the equivalent JSON to `.mcp.json` (project) or `~/.claude.json` (user).

### Acceptance criteria

- [ ] `chemag mcp install --client claude` succeeds and is verifiable via `claude mcp list`.
- [ ] Each client documented in docs site.

---

## WP-018 — Reference monorepo

**Track:** 1
**Effort:** L
**Depends on:** WP-009, WP-010, WP-014, WP-015
**Blocks:** Track 5 (benchmarks), GTM demos

### Description

A real-ish demo monorepo that exercises every feature: TypeScript + Python + Go, three apps, ~30 modules, ~200 files, deliberately seeded with valid architectural decisions. This is the fixture for benchmarks, screenshots, integration tests, and marketing demos.

### Files to create

`apps/reference-monorepo/`:
- `workspace.yaml` declaring three language sub-trees.
- `apps/web/` — Next.js 14 web app, TypeScript, ~12 modules.
- `apps/api/` — FastAPI service, Python, ~10 modules.
- `apps/worker/` — Go background jobs, ~6 modules.
- `packages/contracts/` — generated OpenAPI types, TypeScript.
- `packages/ui-kit/` — shared TS components.
- `packages/shared-domain/` — shared TS value objects.
- `infra/` — runtime declarations (Phase 2 RFC items, optional).

Each module has a `compound.yaml`. Each language has its required public-surface convention enforced.

### Quality bar

- Code compiles, tests pass, `chemag check` is clean, `chemag analyze` is clean.
- The repo represents a plausible startup architecture: an admin web app talking to an API, with a worker doing batch jobs.
- No real secrets, but realistic environment plumbing (.env.example with realistic keys).
- README explains: what this repo is, how to use it, how chem-ag is wired in.

### Tests

- CI runs `pnpm install && chemag check && chemag analyze` on this repo on every PR.
- Snapshots of `chemag graph` output committed.

### Acceptance criteria

- [ ] All three language plugins run cleanly on the repo.
- [ ] `chemag mcp` started in this repo answers `where_should_this_go("add a Stripe payment flow")` with a sensible suggestion.
- [ ] Used as the fixture in WP-047 (benchmark prompts).
- [ ] Embedded in marketing site demo.
