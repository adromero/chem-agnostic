import * as path from "node:path";
import { generateMermaid } from "@chemag/core/graph";
import { discoverCompounds, loadWorkspace } from "@chemag/core/loader";
import type { LoadedCompound, Workspace } from "@chemag/core/types";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const BLD = "\x1b[1m";

export function cmdGraph(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`
${BLD}chemtest graph${R} — visualize compound dependencies

${BLD}Usage:${R}  chemtest graph <workspace.yaml>

Outputs a Mermaid diagram to stdout. Pipe to a file or paste into
a Markdown code block with \`\`\`mermaid fencing.

  Legend:
    solid arrow   →  import dependency
    dashed arrow  →  signal (event) flow
    dotted circle →  catalyst wiring
`);
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

  let compounds: LoadedCompound[];
  try {
    compounds = discoverCompounds(ws, wsDir);
  } catch (e: unknown) {
    console.error(`${RED}Failed to discover compounds:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  console.log(generateMermaid(ws, compounds));
}
