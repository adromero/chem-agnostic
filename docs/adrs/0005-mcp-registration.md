# ADR 0005 — `chemag mcp install/uninstall/status` registration protocol

- Status: Accepted
- Date: 2026-05-02
- Stage: WP-017

## Context

WP-014 ships `chemag mcp` — an MCP server that exposes chemag's tools, resources,
and prompts to MCP-aware clients. WP-017 adds the user-facing on-boarding:
`chemag mcp install --client <claude|cursor|cline|continue|all>` registers the
server with one of four clients in one command. Two questions had to resolve
before any code landed:

1. **Should the install path use the client's CLI when available, or always
   write the JSON config file directly?**
2. **What happens when the client's CLI exits non-zero — fall back to the JSON
   path silently, or fail loudly?**

## Decision

### Two-path design (NEVER silent fallback)

- **Path A — client CLI present AND `--no-cli` not passed:** spawn the
  client's CLI (today: `claude mcp add`). On exit 0 → success. On non-zero
  exit → emit `CHEM-MCP-203` as ERROR; exit non-zero. **NO fallback to
  Path B.**
- **Path B — client CLI absent OR `--no-cli` passed:** write the client's
  MCP config JSON file directly with
  `mcpServers.chemag = { command, args, _chemag: true }`. The `_chemag: true`
  tag identifies our entry on uninstall.

The `--no-cli` flag forces Path B unconditionally. There is no automatic
fallback from Path A to Path B. **This is the most important property of the
design.**

#### Why no silent fallback?

If `claude mcp add` fails (permission denied, malformed --scope arg, network
error during a future remote MCP install, etc.) and we then quietly write
`.mcp.json`, the user has no idea the CLI path failed. The next person to run
`claude mcp list` will see the entry, the next `claude mcp remove chemag` may
or may not work depending on which path was used originally, and we end up
with a divergent surface where the same `--client claude --scope project`
operation can mean two different things. Failing loud forces the user to look
at the actual error and decide whether to retry, pass `--no-cli`, or fix the
underlying CLI problem.

### Verified upstream syntax (Claude Code today)

`claude mcp add --help` (verified at WP-017 implementation time):

```
Usage: claude mcp add [options] <name> <commandOrUrl> [args...]

Options:
  -s, --scope <scope>          Configuration scope (local, user, or project)
  -t, --transport <transport>  Transport type (stdio, sse, http)
  ...
```

Mapping our scopes:

| chemag `--scope` | claude `--scope`     | Where claude writes |
|------------------|----------------------|---------------------|
| `project`        | `project`            | `.mcp.json` (workspace dir) |
| `user`           | `user`               | `~/.claude.json`     |

The exact argv we spawn for install:

```
claude mcp add --scope <scope> chemag -- chemag mcp --workspace <abs path>
```

We use the `--` separator before the chemag command so any future chemag-side
flag is not interpreted by the upstream CLI. The argv is **pinned by the test
suite** (`packages/cli/test/installers/mcp/claude.test.ts` → "spawns
`claude mcp add ...` with the EXACT verified argv"). If upstream syntax
changes, that test fails loudly and the spec is updated in the same commit.

For uninstall:

```
claude mcp remove --scope <scope> chemag
```

`claude mcp remove` exits non-zero when the server is not registered. We
treat that specific case (stderr containing "not found"/"no such") as a
no-op rather than an error — uninstalling something that isn't there is
a sensible thing to do.

### Per-client adapter table

| Client     | Path A CLI?   | Path B file (project)              | Path B file (user)              |
|------------|---------------|------------------------------------|---------------------------------|
| `claude`   | `claude mcp ...` | `<workspace>/.mcp.json`         | `~/.claude.json`                 |
| `cursor`   | (none)        | `<workspace>/.cursor/mcp.json`     | `~/.cursor/mcp.json`             |
| `cline`    | (none)        | `<workspace>/.cline/mcp.json`      | `~/.cline/mcp.json`              |
| `continue` | (none)        | `<workspace>/.continue/mcpServers.json` | `~/.continue/mcpServers.json` |

`cursor`, `cline`, `continue` only ship Path B because they have no public
MCP CLI today.

### Public JSON contract — `mcp status --format json`

The schema lives at `packages/core/schemas/mcp-status.schema.json` and is
authoritative. Once shipped, **any change to the shape requires a changeset
and release notes** — downstream tooling will start parsing it.

```ts
type McpStatusOutput = {
  clients: Array<{
    client: "claude" | "cursor" | "cline" | "continue";
    scope: "user" | "project";
    config_path: string;
    registered: boolean;
    server_command: string | null;
    notes: string[];
  }>;
};
```

The integration test
(`packages/cli/test/commands/mcp-install.test.ts` → "output validates against
packages/core/schemas/mcp-status.schema.json") validates the live output
against that schema with `ajv` so drift is caught at CI time.

### JSON tagging — `_chemag: true`

Each chemag-installed server entry carries `_chemag: true` so the uninstall
flow can identify and remove our entry without disturbing user-managed
servers. We rely on the host MCP parsers tolerating the unknown key (true of
Claude Code, Cursor, Cline, Continue today). If any host ever rejects unknown
keys, this tag can move to a sidecar file (`<dir>/.chemag-mcp.json`) without
changing the CLI surface.

## Diagnostic codes (CHEM-MCP block 201..299)

WP-017 introduces a third 100-block under MCP — **MCP-client-registration**
diagnostics, surfaced through `chemag mcp install/uninstall/status`. They are
disjoint from the existing 001-099 (CLI-startup) and 101-199 (tool-protocol)
sub-blocks.

| Code            | Level | Meaning |
|-----------------|-------|---------|
| `CHEM-MCP-201`  | error | Unknown `--client` value (validation). |
| `CHEM-MCP-202`  | error | Existing MCP config file is not valid JSON; file is left untouched. |
| `CHEM-MCP-203`  | error | Path A client-CLI invocation exited non-zero. **Emitted only on Path A failures, never as a fallback signal.** |

The `packages/core/src/diagnostics/codes.ts` policy comment is extended to
document the 201-299 sub-block alongside the existing 001-099 and 101-199
ranges.

## Consequences

- Operators get a one-shot install that uses the client's preferred path
  when possible (so e.g. `claude mcp list` shows the entry afterward) and
  falls through to a deterministic JSON write when no CLI exists.
- Failing-loud on Path A surfaces real bugs (permission errors, scope arg
  drift) immediately rather than silently masking them.
- The `mcp status --format json` shape is now part of the public surface;
  future changes go through the changeset gate.
- `WP-013` (Cline installer in `chemag install-hooks --tool cline`) reuses
  the shared `cli.install_hooks.tip.mcp_register` vocabulary key to point
  users at `chemag mcp install --client cline` after they install hooks.
  WP-017 owns the rewrite of that key's text (drops the
  "(available after WP-017)" hedge).
