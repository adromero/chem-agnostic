#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cmdCheck } from "./commands/check.js";
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
    } catch {
      continue;
    }
  }
  return "unknown";
}

function printHelp(): void {
  console.log(`chemag v${getVersion()} — language-agnostic Chem architecture toolkit

Usage: chemag [options] [command]
       chem-ag [options] [command]   (alias)

Options:
  --version    Show version number
  --help       Show this help text

Commands:
  init         Bootstrap a new Chem workspace
  add          Add a compound or unit
  check        Validate manifests and file structure
  analyze      Check real imports against bond rules
  scaffold     Generate stub files from manifests
  graph        Output Mermaid dependency diagram
  sync         Generate manifests from existing code
`);
}

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(getVersion());
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  printHelp();
  process.exit(0);
}

const command = args[0];
const commandArgs = args.slice(1);

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
