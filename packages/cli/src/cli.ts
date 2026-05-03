#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveCliVocabulary, setVocabulary } from "@chemag/core/vocabulary";
import {
  defaultConsentIO,
  flushQueue,
  initTelemetry,
  isFirstRun,
  makeOptInConfig,
  makeOptOutConfig,
  promptForConsent,
  saveConfig,
  setTelemetryEnabledForRun,
} from "@chemag/telemetry";
import { setCacheEnabled } from "@chemag/core/cache";
import { cmdCheck } from "./commands/check.js";
import { cmdCheckEdit } from "./commands/check-edit.js";
import { cmdAnalyze } from "./commands/analyze.js";
import { cmdScaffold } from "./commands/scaffold.js";
import { cmdGraph } from "./commands/graph.js";
import { cmdSync } from "./commands/sync.js";
import { cmdInit } from "./commands/init.js";
import { cmdAdd } from "./commands/add.js";
import { cmdConfig } from "./commands/config.js";
import { cmdCompletion } from "./commands/completion.js";
import { cmdEmitRules } from "./commands/emit-rules.js";
import { cmdMcp } from "./commands/mcp.js";
import { cmdInstallHooks } from "./commands/install-hooks.js";
import { cmdCi } from "./ci/index.js";
import { buildCommandTree, renderHelp } from "./cli-meta.js";

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
 *
 * Layout is rendered by `renderHelp(buildCommandTree(...))` from `cli-meta.ts`,
 * which walks the citty `defineCommand` tree. The framework owns layout +
 * completion-script generation; dispatch and global-flag handling stay in
 * this file. See `docs/adrs/0003-cli-framework.md`.
 */
function printHelp(): void {
  // The command tree is built lazily AFTER Phase-1 vocabulary resolution so
  // tr() reads the right locale. We re-build per call (cheap; just builds
  // a small object literal).
  console.log(renderHelp(buildCommandTree(getVersion())));
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

  // Phase 1.6 — telemetry override. Boolean flag, single-token, one-shot for
  // this invocation. Module-local override; does NOT touch the persistent
  // config (`telemetry.enabled` in ~/.config/chemag/config.json stays as-is).
  if (argv.includes("--no-telemetry")) {
    setTelemetryEnabledForRun(false);
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(getVersion());
    process.exit(0);
  }

  // Top-level --help / -h applies only when no subcommand was given. With a
  // subcommand the flag is forwarded to that command's parser so each
  // subcommand can emit its own help block. We look at the dispatch argv
  // (after stripping --vocabulary <v>, --no-cache, and --no-telemetry, all
  // already handled above) and check whether the first positional is missing.
  const dispatchArgsForHelpCheck = stripTelemetryFlag(stripCacheFlag(stripVocabularyFlag(argv)));
  const firstPositional = dispatchArgsForHelpCheck.find((a) => !a.startsWith("-"));
  if ((argv.includes("--help") || argv.includes("-h")) && firstPositional === undefined) {
    printHelp();
    process.exit(0);
  }
  if (argv.length === 0) {
    printHelp();
    process.exit(0);
  }

  // Strip --vocabulary <value> / --vocabulary=<value>, --no-cache, and
  // --no-telemetry from the command argv so command parsers don't treat them
  // as positionals. Phases 1 / 1.5 / 1.6 already captured them.
  const dispatchArgs = stripTelemetryFlag(stripCacheFlag(stripVocabularyFlag(argv)));
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
    case "emit-rules": {
      const code = cmdEmitRules(commandArgs);
      if (code !== 0) process.exit(code);
      break;
    }
    case "config":
      cmdConfig(commandArgs);
      break;
    case "completion":
      cmdCompletion(commandArgs);
      break;
    case "mcp": {
      const code = cmdMcp(commandArgs);
      if (code !== 0) process.exit(code);
      break;
    }
    case "install-hooks": {
      const code = cmdInstallHooks(commandArgs);
      if (code !== 0) process.exit(code);
      break;
    }
    case "ci":
      // cmdCi is async (HTTP I/O) but runCli stays synchronous to keep the
      // existing sync-test harness working. Each provider exits via
      // process.exit on completion or failure, so we never fall through; the
      // .catch is a defensive net for unexpected synchronous throws.
      void cmdCi(commandArgs).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Unexpected error in 'chemag ci': ${msg}`);
        process.exit(2);
      });
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

/**
 * Remove the boolean --no-telemetry token from argv before dispatch.
 * Phase-1.6 resolution already toggled the run-local override. Single-token
 * filter; mirrors stripCacheFlag.
 */
export function stripTelemetryFlag(argv: string[]): string[] {
  return argv.filter((a) => a !== "--no-telemetry");
}

// ---------------------------------------------------------------------------
// Telemetry bootstrap.
//
// runCli() itself stays synchronous so existing tests continue to drive the
// dispatcher without an async harness. The bin shim calls runCliBootstrap,
// which:
//   1. Runs the Phase-1.6 override resolution (mirroring what runCli does
//      internally) so initTelemetry sees the right enabled state. We do this
//      twice — once here, once in runCli — because runCli may be called
//      directly by tests without going through the bootstrap.
//   2. Awaits initTelemetry which loads consent and best-effort flushes any
//      events queued from prior runs.
//   3. Prompts for consent on first run when interactive AND the invocation
//      is NOT --help/--version (so docs/CI surfaces stay quiet). The prompt
//      is skipped entirely when --no-telemetry is present (don't re-ask).
//   4. Hands control to runCli which calls process.exit(...). Any event
//      emitted by a command awaits its own transport before exit, so we do
//      not need a separate process.on("exit") flush.
// ---------------------------------------------------------------------------

function isHelpOrVersion(argv: string[]): boolean {
  if (argv.includes("--version") || argv.includes("-v")) return true;
  // Top-level --help applies only when no positional command is present.
  const dispatch = stripTelemetryFlag(stripCacheFlag(stripVocabularyFlag(argv)));
  const firstPositional = dispatch.find((a) => !a.startsWith("-"));
  return (argv.includes("--help") || argv.includes("-h")) && firstPositional === undefined;
}

export async function runCliBootstrap(argv: string[]): Promise<void> {
  // Resolve --no-telemetry early so initTelemetry / promptForConsent see it.
  if (argv.includes("--no-telemetry")) {
    setTelemetryEnabledForRun(false);
  }

  // Best-effort consent prompt on the very first interactive run. Skipped if:
  //   - --no-telemetry was passed (don't re-ask just to ignore the answer)
  //   - this is a help/version invocation (those exit fast with no telemetry)
  //   - the process is non-interactive (no TTY) — promptForConsent itself
  //     short-circuits to false and prints the one-line note
  if (isFirstRun() && !argv.includes("--no-telemetry") && !isHelpOrVersion(argv)) {
    if (defaultConsentIO.isInteractive()) {
      try {
        const accepted = await promptForConsent(defaultConsentIO);
        saveConfig(accepted ? makeOptInConfig() : makeOptOutConfig());
      } catch {
        // If the prompt itself fails (e.g. stdin closed mid-prompt) we
        // record an opt-out so we don't pester on every run.
        try {
          saveConfig(makeOptOutConfig());
        } catch {
          // best-effort
        }
      }
    } else {
      // Non-interactive: print the one-line hint per the spec to STDERR so
      // it doesn't pollute machine-readable stdout (e.g. `chemag graph > out`,
      // `chemag analyze --format json | jq ...`). Do NOT write a config file
      // — that way the next interactive run will still prompt.
      process.stderr.write("(telemetry off — run chemag config telemetry on to enable)\n");
    }
  }

  // Load consent + flush any prior-run queue (best-effort).
  await initTelemetry();

  // Wrap runCli in try/finally so a synchronous throw before a command's own
  // per-event flush completes still gets one last best-effort drain. Note:
  // process.exit() short-circuits `finally` in Node, so this only fires on
  // the unusual path where dispatch throws before exiting. The normal path
  // (commands call process.exit; the per-event flush ran first) is unchanged.
  try {
    runCli(argv);
  } finally {
    await flushTelemetryOnExit();
  }
}

/**
 * Final-flush hook. Commands that emit telemetry during their lifetime should
 * call this just before process.exit so any failed events make it to the
 * persistent queue. Currently a no-op delegating to flushQueue (which is
 * idempotent) so callers can adopt without conditionals.
 */
export async function flushTelemetryOnExit(): Promise<void> {
  await flushQueue();
}

// Note: this module no longer auto-runs the CLI on import. The bin shim
// (packages/cli/bin/chem-ag) calls runCliBootstrap(process.argv.slice(2)).
// runCli stays exported and synchronous for tests that want to drive it
// without a telemetry harness.
