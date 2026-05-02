// ---------------------------------------------------------------------------
// `list_compounds` — enumerate all compounds in the workspace, optionally
// filtered by container type. Returns a compact summary suitable for an
// agent's planning loop (counts, paths, roles present).
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { z } from "zod";
import type { Session } from "../context.js";
import { resolvePlugin } from "./plugin-resolver.js";
import type { Tool } from "./types.js";

const inputSchema = {
  type: z.enum(["compound", "reagent", "solvent", "catalyst"]).optional(),
};

export interface CompoundSummary {
  name: string;
  type: "compound" | "reagent" | "solvent" | "catalyst";
  description?: string;
  public_surface_path: string;
  roles_present: string[];
  units_count: number;
}

export interface ListCompoundsOutput {
  compounds: CompoundSummary[];
}

export const listCompoundsTool: Tool<typeof inputSchema, ListCompoundsOutput> = {
  name: "list_compounds",
  description:
    "List all compounds in the workspace, optionally filtered by container type. Each entry summarizes the compound's type, description, public surface path, the set of roles it currently uses, and its unit count.",
  inputSchema,
  async handler(input, session: Session): Promise<ListCompoundsOutput> {
    const workspace = await session.loadWorkspace();
    const compounds = await session.listCompounds();
    const plugin = resolvePlugin(workspace);
    const surfaceFile = workspace.rules?.public_surface ?? plugin.defaults.publicSurface;

    const out: CompoundSummary[] = [];
    for (const c of compounds) {
      const type = (c.manifest.type ?? "compound") as CompoundSummary["type"];
      if (input.type && type !== input.type) continue;

      const roles = new Set<string>();
      for (const u of c.manifest.units ?? []) roles.add(u.role);

      out.push({
        name: c.manifest.compound,
        type,
        ...(c.manifest.description ? { description: c.manifest.description } : {}),
        public_surface_path: path.relative(session.workspaceDir, path.join(c.dir, surfaceFile)),
        roles_present: [...roles].sort(),
        units_count: (c.manifest.units ?? []).length,
      });
    }

    return { compounds: out };
  },
};
