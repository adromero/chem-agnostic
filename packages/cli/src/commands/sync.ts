import * as path from "node:path";
import { loadWorkspace } from "@chemag/core/loader";
import { loadPlugin } from "../plugin-loader.js";
import { syncWorkspace } from "@chemag/core/sync";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

export function cmdSync(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`
${BLD}chem sync${R} — generate manifests from existing code

${BLD}Usage:${R}  chem sync <workspace.yaml> [options]

${BLD}Options:${R}
  --dry-run   Show what would be created without writing files

Scans compound directories for source files, infers roles from folder
names, and generates compound.yaml for any compound that doesn't
already have one. Existing manifests are never overwritten.
`);
    process.exit(0);
  }

  const dryRun = argv.includes("--dry-run");
  const wsArg = argv.find((a) => !a.startsWith("-"));

  if (!wsArg) {
    console.error(`${RED}No workspace file specified.${R}`);
    process.exit(2);
  }

  const wsPath = path.resolve(wsArg);
  const wsDir = path.dirname(wsPath);

  let ws;
  try {
    ws = loadWorkspace(wsPath);
  } catch (e: unknown) {
    console.error(
      `${RED}Failed to load workspace:${R} ${e instanceof Error ? e.message : e}`,
    );
    process.exit(2);
  }

  const plugin = loadPlugin({ language: ws.language });

  console.log(
    `\n${BLD}chem sync${R}${dryRun ? ` ${DIM}(dry run)${R}` : ""}\n`,
  );
  console.log(`${BLD}Workspace:${R} ${ws.workspace}\n`);

  const result = syncWorkspace(ws, wsDir, plugin, dryRun);

  for (const f of result.created) {
    console.log(`  ${GRN}+${R}  ${path.relative(wsDir, f)}`);
  }
  for (const f of result.skipped) {
    console.log(`  ${DIM}-  ${path.relative(wsDir, f)} (exists)${R}`);
  }

  console.log();
  console.log(
    `${GRN}${BLD}${result.created.length}${R} manifest(s) generated, ` +
      `${DIM}${result.skipped.length} skipped${R}\n`,
  );
}
