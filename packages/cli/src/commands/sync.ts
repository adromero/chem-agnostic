import * as path from "node:path";
import { loadWorkspace } from "@chemag/core/loader";
import { syncWorkspace, type SyncResult } from "@chemag/core/sync";
import type { Workspace } from "@chemag/core/types";
import { applyWorkspaceVocabulary, tr } from "@chemag/core/vocabulary";
import { loadPlugin } from "../plugin-loader.js";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

export function cmdSync(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`\n${BLD}${tr("cli.command.sync")}${R}\n`);
    console.log(
      `${BLD}Options:${R}\n  --dry-run   Show what would be created without writing files\n\nScans module directories for source files, infers roles from folder\nnames, and generates compound.yaml for any module that doesn't\nalready have one. Existing manifests are never overwritten.\n`,
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

  console.log(`\n${BLD}chem sync${R}${dryRun ? ` ${DIM}(dry run)${R}` : ""}\n`);
  console.log(`${BLD}Workspace:${R} ${ws.workspace}\n`);

  // WP-020: iterate every sub-tree, loading the matching plugin per
  // sub-tree and scanning its own path roots. The loader guarantees
  // ws.languages is non-empty after normalization (legacy single-language
  // workspaces are synthesized into a one-element "default" sub-tree).
  const subtrees = ws.languages ?? [{ id: "default", language: ws.language, paths: ws.paths }];
  const result: SyncResult = { created: [], skipped: [] };
  for (const sub of subtrees) {
    const plugin = loadPlugin({ language: sub.language });
    const r = syncWorkspace(ws, wsDir, plugin, dryRun, sub.paths);
    result.created.push(...r.created);
    result.skipped.push(...r.skipped);
  }

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
