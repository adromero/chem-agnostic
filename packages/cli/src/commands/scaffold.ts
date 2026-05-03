import * as path from "node:path";
import { discoverCompoundsBySubtree, loadWorkspace } from "@chemag/core/loader";
import { scaffoldWorkspace, type ScaffoldResult } from "@chemag/core/scaffold";
import type { LanguageSubtree, LoadedCompound, Workspace } from "@chemag/core/types";
import { applyWorkspaceVocabulary, tr } from "@chemag/core/vocabulary";
import { loadPlugin } from "../plugin-loader.js";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

export function cmdScaffold(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`\n${BLD}${tr("cli.command.scaffold")}${R}\n`);
    console.log(
      `${BLD}Options:${R}\n  --dry-run   Show what would be created without writing files\n`,
    );
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

  let ws: Workspace;
  try {
    ws = loadWorkspace(wsPath);
  } catch (e: unknown) {
    console.error(`${RED}Failed to load workspace:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  // Phase 2 — adopt workspace.vocabulary if Phase 1 (cli.ts) didn't already
  // settle on a stronger source. Must run before any tr() output below.
  applyWorkspaceVocabulary(ws);

  // WP-020: discover compounds per sub-tree, then scaffold each sub-tree
  // with its own language plugin.
  let groups: { scope: LanguageSubtree; compounds: LoadedCompound[] }[];
  try {
    groups = discoverCompoundsBySubtree(ws, wsDir);
  } catch (e: unknown) {
    console.error(`${RED}Failed to discover compounds:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  console.log(`\n${BLD}chem scaffold${R}${dryRun ? ` ${DIM}(dry run)${R}` : ""}\n`);
  console.log(`${BLD}Workspace:${R} ${ws.workspace}`);
  console.log();

  // Run one scaffold per sub-tree, aggregating results. The work itself is
  // synchronous (file I/O via fs.writeFileSync) — running sub-trees in
  // parallel via Promise.all would not actually overlap any I/O on a single
  // event-loop thread, so we iterate sequentially and keep cmdScaffold's
  // synchronous signature.
  const result: ScaffoldResult = { created: [], skipped: [] };
  for (const g of groups) {
    const plugin = loadPlugin({ language: g.scope.language });
    const r = scaffoldWorkspace(ws, g.compounds, plugin, dryRun);
    result.created.push(...r.created);
    result.skipped.push(...r.skipped);
  }

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
