// ---------------------------------------------------------------------------
// `get_compound` — return a deep view of a single compound: manifest path,
// exports, imports, units, signals, and a Mermaid subgraph filtered to that
// compound + its 1-hop neighbours.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { z } from "zod";
import { generateMermaid } from "@chemag/core/graph";
import type { Compound, LoadedCompound } from "@chemag/core/types";
import type { Session } from "../context.js";
import type { Tool } from "./types.js";

const inputSchema = {
  name: z.string().min(1, "name is required"),
};

export interface GetCompoundOutput {
  name: string;
  type: "compound" | "reagent" | "solvent" | "catalyst";
  description?: string;
  manifest_path: string;
  exports: Compound["exports"];
  imports: Compound["imports"];
  units: Compound["units"];
  signals?: Compound["signals"];
  graph_subgraph_mermaid: string;
}

export const getCompoundTool: Tool<typeof inputSchema, GetCompoundOutput> = {
  name: "get_compound",
  description:
    "Return a full description of a single compound: type, exports, imports, units, signals, and a Mermaid subgraph filtered to the compound and its 1-hop neighbours. Errors if the compound does not exist.",
  inputSchema,
  async handler(input, session: Session): Promise<GetCompoundOutput> {
    const workspace = await session.loadWorkspace();
    const compounds = await session.listCompounds();
    const target = compounds.find((c) => c.manifest.compound === input.name);
    if (!target) throw new Error(`Compound "${input.name}" not found.`);

    const manifestFile = workspace.rules?.manifest_filename ?? "compound.yaml";
    const manifestPath = path.relative(session.workspaceDir, path.join(target.dir, manifestFile));

    // 1-hop subgraph: target + every compound it imports + every compound
    // that imports it.
    const neighbourNames = new Set<string>([target.manifest.compound]);
    for (const imp of target.manifest.imports ?? []) neighbourNames.add(imp.compound);
    for (const c of compounds) {
      for (const imp of c.manifest.imports ?? []) {
        if (imp.compound === target.manifest.compound) neighbourNames.add(c.manifest.compound);
      }
    }
    const subgraph = compounds.filter((c) =>
      neighbourNames.has(c.manifest.compound),
    ) as LoadedCompound[];

    return {
      name: target.manifest.compound,
      type: (target.manifest.type ?? "compound") as GetCompoundOutput["type"],
      ...(target.manifest.description ? { description: target.manifest.description } : {}),
      manifest_path: manifestPath,
      exports: target.manifest.exports,
      imports: target.manifest.imports,
      units: target.manifest.units,
      ...(target.manifest.signals ? { signals: target.manifest.signals } : {}),
      graph_subgraph_mermaid: generateMermaid(workspace, subgraph),
    };
  },
};
