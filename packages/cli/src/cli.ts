#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveCliVocabulary, setVocabulary, tr } from "@chemag/core/vocabulary";
import { setCacheEnabled } from "./cache/cache-state.js";
import { cmdCheck } from "./commands/check.js";
import { cmdCheckEdit } from "./commands/check-edit.js";
import { cmdAnalyze } from "./commands/analyze.js";
import { cmdScaffold } from "./commands/scaffold.js";
import { cmdGraph } from "./commands/graph.js";
import { cmdSync } from "./commands/sync.js";
import { cmdInit } from "./commands/init.js";
import { cmdAdd } from "./commands/add.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  // Resolve packages/cli/package.json from either compiled dist or tsx dev runs.
  // Layouts checked, in order:
  //   ../package.json       (compiled: packages/cli/dist/cli.js -> packages/cli/package.json)
  //   ../../package.json    (tsx dev: packages/cli/src/cli.ts   -> packages/cli/package.json)
  //   ../../../package.json (compiled commands: packages/cli/dist/commands/foo.js, etc.)
  for (const rel of ["..", "../..", "../../.."]) {
    const pkgPath = join(__dirname, rel, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.name === "@chemag/cli") {
        return pkg.version as string;
      }
    } catch {}
  }
  return "unknown";
}

/**
 * Print top-level help. Uses the active (Phase-1) vocabulary so flag/env
 * choices propagate to help output. Workspace-sourced vocabulary is NOT
 * applied here because help exits before any workspace is loaded — this is
 * a documented limitation.
 */
function printHelp(): void {
  const intro = tr("cli.help.intro", { version: getVersion() });
  const usage = tr("cli.help.usage");
  const options = tr("cli.help.options");
  const commands = tr("cli.help.commands");
  console.log(`${intro}\n\n${usage}\n\n${options}\n\n${commands}\n`);
}

/**
 * Run the CLI dispatcher. Exposed as a function so tests can drive it
 * without spawning a subprocess and assert that --help exits without
 * touching loadWorkspace.
 */
export function runCli(argv: string[]): void {
  // Phase 1 — resolve vocabulary from flag/env/default and lock it in
  // before any other work happens. This is what --help and --version use.
  const { name, source } = resolveCliVocabulary(argv, process.env);
  setVocabulary(name, source);

  // Phase 1.5 — resolve --no-cache. The flag only ever toggles caching
  // off; default state (enabled) is preserved when the flag is absent.
  // Mirrors the `--vocabulary` shape (resolve early, strip before dispatch).
  if (argv.includes("--no-cache")) {
    setCacheEnabled(false);
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(getVersion());
    process.exit(0);
  }

  // Top-level --help / -h applies only when no subcommand was given. With a
  // subcommand the flag is forwarded to that command's parser so each
  // subcommand can emit its own help block. We look at the dispatch argv
  // (after stripping --vocabulary <v> and --no-cache, both already handled
  // above) and check whether the first positional is missing.
  const dispatchArgsForHelpCheck = stripCacheFlag(stripVocabularyFlag(argv));
  const firstPositional = dispatchArgsForHelpCheck.find((a) => !a.startsWith("-"));
  if ((argv.includes("--help") || argv.includes("-h")) && firstPositional === undefined) {
    printHelp();
    process.exit(0);
  }
  if (argv.length === 0) {
    printHelp();
    process.exit(0);
  }

  // Strip --vocabulary <value> / --vocabulary=<value> and --no-cache from
  // the command argv so command parsers don't treat them as positionals.
  // Phase 1 / 1.5 already captured them.
  const dispatchArgs = stripCacheFlag(stripVocabularyFlag(argv));
  const command = dispatchArgs[0];
  const commandArgs = dispatchArgs.slice(1);

  switch (command) {
    case "init":
      cmdInit(commandArgs);
      break;
    case "add":
      cmdAdd(commandArgs);
      break;
    case "check":
      cmdCheck(commandArgs);
      break;
    case "check-edit":
      cmdCheckEdit(commandArgs);
      break;
    case "analyze":
      cmdAnalyze(commandArgs);
      break;
    case "scaffold":
      cmdScaffold(commandArgs);
      break;
    case "graph":
      cmdGraph(commandArgs);
      break;
    case "sync":
      cmdSync(commandArgs);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error(`Run 'chemag --help' for a list of available commands.`);
      process.exit(1);
  }
}

/**
 * Remove --vocabulary <name> and --vocabulary=<name> tokens from argv before
 * dispatch. Phase-1 resolution already consumed them.
 */
function stripVocabularyFlag(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vocabulary") {
      i++; // skip the value too
      continue;
    }
    if (a.startsWith("--vocabulary=")) continue;
    out.push(a);
  }
  return out;
}

/**
 * Remove the boolean --no-cache token from argv before dispatch. Phase-1.5
 * resolution already toggled the cache-state module flag. `--no-cache` takes
 * no value so this is a single-token filter.
 *
 * Exported (named, not via `export`) for unit tests; plain function suffices.
 */
export function stripCacheFlag(argv: string[]): string[] {
  return argv.filter((a) => a !== "--no-cache");
}

// Note: this module no longer auto-runs the CLI on import. The bin shim
// (packages/cli/bin/chem-ag) calls runCli(process.argv.slice(2)) explicitly.
// This lets tests import runCli without invoking the CLI as a side effect.
