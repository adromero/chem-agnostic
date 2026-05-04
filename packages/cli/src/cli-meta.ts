// ---------------------------------------------------------------------------
// CLI metadata — citty `defineCommand` declarations.
//
// This module is the **adapter layer** between `chemag`'s hand-rolled
// dispatcher (`runCli`) and the citty framework. citty owns:
//   1. Help-text layout (rendered by `renderHelp` below).
//   2. Completion-script generation (consumed by `scripts/gen-completions.ts`).
//   3. Argument metadata (used for help only; NOT for dispatch).
//
// citty does NOT own:
//   - Dispatch (the switch in `runCli` stays).
//   - process.exit (commands keep calling `process.exit` directly).
//   - argv parsing (each `cmdXxx(argv)` keeps its existing parser).
//   - Phase-1/1.5/1.6 global flags (--vocabulary, --no-cache, --no-telemetry
//     are documented as global flags and stripped before dispatch — citty
//     declarations must NOT list them as command options).
//
// `buildCommandTree()` is intentionally lazy: it consults `tr()` which reads
// the active vocabulary, and Phase-1 vocabulary resolution must run before
// help is rendered. Calling at module-top-level would freeze the locale.
// ---------------------------------------------------------------------------

import { defineCommand, type CommandDef } from "citty";
import { tr } from "@chemag/core/vocabulary";
import { colors, isColorSupported } from "./ui/colors.js";

// Command groupings shown in `chemag --help`. Keys match the citty subcommand
// registry below; values are the human group label.
const COMMAND_GROUPS: { title: string; commands: string[] }[] = [
  { title: "Workspace", commands: ["init", "add"] },
  { title: "Validation", commands: ["check", "check-edit", "analyze"] },
  { title: "Generation", commands: ["scaffold", "graph", "sync", "emit-rules"] },
  { title: "Integrations", commands: ["mcp", "lsp", "install-hooks", "ci"] },
  { title: "Utilities", commands: ["config", "completion"] },
];

/**
 * Build the citty command tree. Called lazily because tr() depends on the
 * Phase-1 vocabulary resolution that happens early in runCli.
 */
export function buildCommandTree(version: string): CommandDef {
  return defineCommand({
    meta: {
      name: "chemag",
      version,
      description: tr("cli.help.intro", { version }),
    },
    args: {
      // Top-level only documents --help / --version. Global flags
      // (--vocabulary / --no-cache / --no-telemetry) are stripped before
      // dispatch and rendered separately.
    },
    subCommands: {
      init: defineCommand({
        meta: {
          name: "init",
          description: firstLine(tr("cli.command.init")),
        },
        args: {
          name: { type: "positional", description: "Workspace name" },
          path: { type: "string", description: "Output directory (default: cwd)" },
          language: {
            type: "enum",
            description: "Plugin to bootstrap with",
            options: ["typescript", "python"],
          },
        },
      }),

      add: defineCommand({
        meta: {
          name: "add",
          description: firstLine(tr("cli.command.add")),
        },
        args: {
          kind: {
            type: "positional",
            description: "What to add: compound | unit",
          },
          // Remaining positionals depend on `kind`; citty doesn't model
          // sum-type positional schemas, so we under-document here.
        },
      }),

      check: defineCommand({
        meta: {
          name: "check",
          description: firstLine(tr("cli.command.check")),
        },
        args: {
          workspace: { type: "positional", description: "Path to workspace.yaml" },
          "manifest-only": {
            type: "boolean",
            description: "Skip filesystem checks",
          },
          verbose: { type: "boolean", description: "Verbose output" },
          format: {
            type: "enum",
            description: "Output format",
            options: ["pretty", "json", "sarif", "junit"],
          },
          explain: { type: "string", description: "Print docs for a diagnostic code" },
        },
      }),

      "check-edit": defineCommand({
        meta: {
          name: "check-edit",
          description: "Validate a single file edit against module rules.",
        },
        args: {
          file: { type: "positional", description: "File path to validate" },
          format: {
            type: "enum",
            description: "Output format",
            options: ["pretty", "json", "sarif"],
          },
        },
      }),

      analyze: defineCommand({
        meta: {
          name: "analyze",
          description: firstLine(tr("cli.command.analyze")),
        },
        args: {
          workspace: { type: "positional", description: "Path to workspace.yaml" },
          format: {
            type: "enum",
            description: "Output format",
            options: ["pretty", "json", "sarif", "junit"],
          },
        },
      }),

      scaffold: defineCommand({
        meta: {
          name: "scaffold",
          description: firstLine(tr("cli.command.scaffold")),
        },
        args: {
          workspace: { type: "positional", description: "Path to workspace.yaml" },
          "dry-run": { type: "boolean", description: "Print actions without writing" },
        },
      }),

      graph: defineCommand({
        meta: {
          name: "graph",
          description: firstLine(tr("cli.command.graph")),
        },
        args: {
          workspace: { type: "positional", description: "Path to workspace.yaml" },
        },
      }),

      sync: defineCommand({
        meta: {
          name: "sync",
          description: firstLine(tr("cli.command.sync")),
        },
        args: {
          workspace: { type: "positional", description: "Path to workspace.yaml" },
          "dry-run": { type: "boolean", description: "Print actions without writing" },
        },
      }),

      "emit-rules": defineCommand({
        meta: {
          name: "emit-rules",
          description: firstLine(tr("cli.command.emit_rules")),
        },
        args: {
          tool: {
            type: "string",
            description:
              "Target tool: claude|agents|codex|cursor|copilot|aider|cline|all (default: all)",
          },
          workspace: {
            type: "string",
            description: "Path to workspace.yaml (default: ./workspace.yaml)",
          },
          "out-dir": {
            type: "string",
            description: "Output base directory (default: workspace dir)",
          },
          "max-lines": {
            type: "string",
            description: "Override default per-tool line budget",
          },
          "include-violations": {
            type: "boolean",
            description: "Embed current chemag violations as fix-me hints",
          },
          "dry-run": {
            type: "boolean",
            description: "Print planned actions without writing files",
          },
          diff: {
            type: "boolean",
            description: "Print unified diff per file that would change",
          },
          overwrite: {
            type: "boolean",
            description: "Allow replacing files without chemag markers",
          },
        },
      }),

      mcp: defineCommand({
        meta: {
          name: "mcp",
          description: firstLine(tr("cli.command.mcp")),
        },
        args: {
          workspace: {
            type: "string",
            description: "Workspace directory (defaults to cwd)",
          },
          transport: {
            type: "enum",
            description: "Transport (stdio; sse reserved for v1.0.x)",
            options: ["stdio", "sse"],
          },
        },
        // WP-017: install/uninstall/status nested under `mcp`. citty owns
        // help/metadata; dispatch happens in cmdMcp via a small subcommand
        // switch.
        subCommands: {
          install: defineCommand({
            meta: {
              name: "install",
              description: firstLine(tr("cli.command.mcp_install")),
            },
            args: {
              client: {
                type: "string",
                description: "MCP client: claude|cursor|cline|continue|all",
              },
              scope: {
                type: "enum",
                description: "Scope: user or project (default: project)",
                options: ["user", "project"],
              },
              workspace: {
                type: "string",
                description: "Workspace directory (defaults to cwd)",
              },
              "no-cli": {
                type: "boolean",
                description: "Skip the client's CLI; write the MCP config file directly",
              },
              "dry-run": {
                type: "boolean",
                description: "Print planned changes without writing or invoking any CLI",
              },
            },
          }),
          uninstall: defineCommand({
            meta: {
              name: "uninstall",
              description: firstLine(tr("cli.command.mcp_uninstall")),
            },
            args: {
              client: {
                type: "string",
                description: "MCP client: claude|cursor|cline|continue|all",
              },
              scope: {
                type: "enum",
                description: "Scope: user or project (default: project)",
                options: ["user", "project"],
              },
              workspace: {
                type: "string",
                description: "Workspace directory (defaults to cwd)",
              },
              "no-cli": {
                type: "boolean",
                description: "Skip the client's CLI; mutate the MCP config file directly",
              },
              "dry-run": {
                type: "boolean",
                description: "Print planned changes without writing or invoking any CLI",
              },
            },
          }),
          status: defineCommand({
            meta: {
              name: "status",
              description: firstLine(tr("cli.command.mcp_status")),
            },
            args: {
              format: {
                type: "enum",
                description: "Output format",
                options: ["pretty", "json"],
              },
              scope: {
                type: "enum",
                description: "Scope to inspect (default: project)",
                options: ["user", "project"],
              },
              workspace: {
                type: "string",
                description: "Workspace directory (defaults to cwd)",
              },
            },
          }),
        },
      }),

      lsp: defineCommand({
        meta: {
          name: "lsp",
          description: "lsp — run a Language Server Protocol server for chemag (stdio).",
        },
        // No flags today: workspace root is discovered from the LSP
        // `initialize` request, not from CLI argv. --help is handled by the
        // dispatcher's per-command parser.
        args: {},
      }),

      "install-hooks": defineCommand({
        meta: {
          name: "install-hooks",
          description: firstLine(tr("cli.command.install_hooks")),
        },
        args: {
          tool: {
            type: "string",
            description:
              "Editor / agent target: claude, cursor, codex (aider|cline|copilot|all coming soon)",
          },
          scope: {
            type: "enum",
            description: "Where to install: user or project (default: project)",
            options: ["user", "project"],
          },
          mode: {
            type: "enum",
            description: "Hook mode: block (default), warn, or context-only",
            options: ["block", "warn", "context-only"],
          },
          uninstall: {
            type: "boolean",
            description: "Remove chemag hook entries (preserves non-chemag entries)",
          },
          restore: {
            type: "boolean",
            description: "With --uninstall: restore from <settings>.bak",
          },
          "dry-run": {
            type: "boolean",
            description: "Print planned changes without writing",
          },
          workspace: {
            type: "string",
            description: "Workspace root (defaults to cwd)",
          },
        },
      }),

      ci: defineCommand({
        meta: {
          name: "ci",
          description: "Post chemag results to a CI provider's MR/PR review surface.",
        },
        args: {
          provider: {
            type: "positional",
            description: "CI provider: gitlab | bitbucket",
          },
        },
        subCommands: {
          gitlab: defineCommand({
            meta: {
              name: "gitlab",
              description: "Post or update a sticky chemag comment on a GitLab MR.",
            },
            args: {
              input: {
                type: "string",
                description: "Read chemag --format json from <file> (default: stdin)",
              },
              workspace: {
                type: "string",
                description: "Workspace name to render in the comment heading",
              },
            },
          }),
          bitbucket: defineCommand({
            meta: {
              name: "bitbucket",
              description: "Post or update a sticky chemag comment on a Bitbucket PR.",
            },
            args: {
              input: {
                type: "string",
                description: "Read chemag --format json from <file> (default: stdin)",
              },
              workspace: {
                type: "string",
                description: "Workspace name to render in the comment heading",
              },
            },
          }),
        },
      }),

      config: defineCommand({
        meta: {
          name: "config",
          description: "Get or set chem-ag configuration values.",
        },
        args: {
          op: {
            type: "positional",
            description: "Operation: get | set | unset",
          },
          key: {
            type: "positional",
            description: "Configuration key (e.g. telemetry.enabled)",
          },
        },
      }),

      completion: defineCommand({
        meta: {
          name: "completion",
          description: "Print shell completion script (bash | zsh | fish).",
        },
        args: {
          shell: {
            type: "positional",
            description: "Target shell",
          },
        },
      }),
    },
  });
}

/**
 * Render the top-level `chemag --help` output synchronously.
 *
 * Why not citty's renderUsage? renderUsage is async, but `runCli` is exported
 * as a synchronous function (an invariant tested across 11 test files). We
 * walk the command tree ourselves — the metadata structure is plain objects
 * authored above, so no Promise machinery is needed.
 *
 * Layout:
 *   <intro>
 *
 *   USAGE: chemag [global-flags] <command> [options]
 *
 *   GLOBAL FLAGS:
 *     --vocabulary <v>   ...
 *     --no-cache         ...
 *     --no-telemetry     ...
 *     --help / -h        ...
 *     --version / -v     ...
 *
 *   <Group title>:
 *     <cmd>      <description>
 *     ...
 *
 *   Run 'chemag <command> --help' for command-specific help.
 */
export function renderHelp(tree: CommandDef): string {
  const meta = (tree.meta as { description?: string; name?: string; version?: string }) ?? {};
  const subs = (tree.subCommands as Record<string, CommandDef> | undefined) ?? {};

  const lines: string[] = [];
  lines.push(meta.description ?? "");
  lines.push("");
  lines.push(`${heading("USAGE:")} chemag [global-flags] <command> [options]`);
  lines.push("");
  lines.push(heading("GLOBAL FLAGS:"));
  lines.push(...formatGlobalFlags());
  lines.push("");

  for (const group of COMMAND_GROUPS) {
    const rows: [string, string][] = [];
    for (const cmd of group.commands) {
      const sub = subs[cmd];
      if (!sub) continue;
      const subMeta = (sub.meta as { description?: string }) ?? {};
      rows.push([cmd, subMeta.description ?? ""]);
    }
    if (rows.length === 0) continue;
    lines.push(heading(`${group.title.toUpperCase()}:`));
    lines.push(...formatTwoColumn(rows, 14));
    lines.push("");
  }

  lines.push(`Run ${codeSpan("chemag <command> --help")} for command-specific help.`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function firstLine(s: string): string {
  const idx = s.indexOf("\n");
  return idx === -1 ? s : s.slice(0, idx);
}

function heading(s: string): string {
  return isColorSupported() ? colors.bold(s) : s;
}

function codeSpan(s: string): string {
  return isColorSupported() ? colors.cyan(s) : `'${s}'`;
}

function formatTwoColumn(rows: [string, string][], leftWidth: number): string[] {
  return rows.map(([left, right]) => {
    const pad = " ".repeat(Math.max(2, leftWidth - left.length));
    const leftCol = isColorSupported() ? colors.cyan(left) : left;
    return `  ${leftCol}${pad}${right}`;
  });
}

function formatGlobalFlags(): string[] {
  const flags: [string, string][] = [
    ["--vocabulary <v>", "Vocabulary: standard or chemistry"],
    ["--no-cache", "Disable manifest/imports cache for this run"],
    ["--no-telemetry", "Disable usage telemetry for this run (config unchanged)"],
    ["--quiet", "Suppress spinners and informational output"],
    ["--help, -h", "Show help"],
    ["--version, -v", "Show version"],
  ];
  return formatTwoColumn(flags, 18);
}
