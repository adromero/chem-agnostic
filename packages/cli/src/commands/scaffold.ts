import * as path from "node:path";
import { loadWorkspace, discoverCompounds } from "@chemag/core/loader";
import { loadPlugin } from "../plugin-loader.js";
import { scaffoldWorkspace } from "@chemag/core/scaffold";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

export function cmdScaffold(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`
${BLD}chem scaffold${R} — generate stub files from manifests

${BLD}Usage:${R}  chem scaffold <workspace.yaml> [options]

${BLD}Options:${R}
  --dry-run   Show what would be created without writing files
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

  let compounds;
  try {
    compounds = discoverCompounds(ws, wsDir);
  } catch (e: unknown) {
    console.error(
      `${RED}Failed to discover compounds:${R} ${e instanceof Error ? e.message : e}`,
    );
    process.exit(2);
  }

  console.log(
    `\n${BLD}chem scaffold${R}${dryRun ? ` ${DIM}(dry run)${R}` : ""}\n`,
  );
  console.log(`${BLD}Workspace:${R} ${ws.workspace}`);
  console.log();

  const result = scaffoldWorkspace(ws, compounds, plugin, dryRun);

  for (const f of result.created) {
    const rel = path.relative(wsDir, f);
    console.log(`  ${GRN}+${R}  ${rel}`);
  }
  for (const f of result.skipped) {
    const rel = path.relative(wsDir, f);
    console.log(`  ${DIM}-  ${rel} (exists)${R}`);
  }

  console.log();
  console.log(
    `${GRN}${BLD}${result.created.length}${R} files created, ` +
      `${DIM}${result.skipped.length} skipped${R}\n`,
  );
}
