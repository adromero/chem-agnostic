import * as path from "node:path";
import { generateMermaid } from "@chemag/core/graph";
import { discoverCompounds, loadWorkspace } from "@chemag/core/loader";
import type { LoadedCompound, Workspace } from "@chemag/core/types";
import { applyWorkspaceVocabulary, tr } from "@chemag/core/vocabulary";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const BLD = "\x1b[1m";

export function cmdGraph(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`\n${BLD}${tr("cli.command.graph")}${R}\n`);
    console.log(
      "Outputs a Mermaid diagram to stdout. Pipe to a file or paste into\n" +
        "a Markdown code block with ```mermaid fencing.\n\n" +
        "  Legend:\n" +
        "    solid arrow   →  import dependency\n" +
        "    dashed arrow  →  signal (event) flow\n" +
        "    dotted circle →  catalyst wiring\n",
    );
    process.exit(0);
  }

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

  let compounds: LoadedCompound[];
  try {
    compounds = discoverCompounds(ws, wsDir);
  } catch (e: unknown) {
    console.error(`${RED}Failed to discover compounds:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  console.log(generateMermaid(ws, compounds));
}
