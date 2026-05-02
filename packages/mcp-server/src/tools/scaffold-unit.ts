// ---------------------------------------------------------------------------
// `scaffold_unit` — wraps `addUnitToCompound` from @chemag/core to:
//   1. patch compound.yaml,
//   2. scaffold the stub source file via the language plugin,
//   3. compute a unified-diff string from manifestBefore/manifestAfter
//      using the `diff` package (the diff dep lives at the consumer
//      layer; @chemag/core is diff-free).
// ---------------------------------------------------------------------------

import { createPatch } from "diff";
import * as path from "node:path";
import { z } from "zod";
import {
  addUnitToCompound,
  CompoundNotFoundError,
  DuplicateUnitError,
  UnknownRoleError,
} from "@chemag/core/add-unit";
import type { Session } from "../context.js";
import { resolvePlugin } from "./plugin-resolver.js";
import type { Tool } from "./types.js";

const inputSchema = {
  compound: z.string().min(1, "compound is required"),
  role: z.string().min(1, "role is required"),
  name: z.string().min(1, "name is required"),
  export: z.boolean().optional(),
  implements: z.string().optional(),
};

export interface ScaffoldUnitOutput {
  created: string[];
  manifest_diff: string;
}

export const scaffoldUnitTool: Tool<typeof inputSchema, ScaffoldUnitOutput> = {
  name: "scaffold_unit",
  description:
    "Add a new unit to a compound: patch compound.yaml, scaffold the stub source file via the active language plugin, and return a unified-diff of the manifest change. Equivalent to running `chemag add unit <compound> <role> <name>`.",
  inputSchema,
  async handler(input, session: Session): Promise<ScaffoldUnitOutput> {
    const workspace = await session.loadWorkspace();
    const plugin = resolvePlugin(workspace);

    let result: ReturnType<typeof addUnitToCompound>;
    try {
      result = addUnitToCompound({
        workspace,
        workspaceDir: session.workspaceDir,
        compoundName: input.compound,
        role: input.role,
        unitName: input.name,
        export: input.export,
        implementsSymbol: input.implements,
        plugin,
      });
    } catch (err) {
      // Re-throw with a stable message — the registry layer maps these to
      // CHEM-MCP-103 (tool_handler_failed) responses with the message text
      // preserved in the diagnostic body.
      if (
        err instanceof UnknownRoleError ||
        err instanceof CompoundNotFoundError ||
        err instanceof DuplicateUnitError
      ) {
        throw new Error(err.message);
      }
      throw err;
    }

    // Compute a unified diff against the manifest's relative path so the
    // patch reads naturally for an agent surfacing it to a human.
    const relManifest = path.relative(session.workspaceDir, result.manifestPath);
    const manifest_diff = createPatch(
      relManifest,
      result.manifestBefore,
      result.manifestAfter,
      "before",
      "after",
    );

    const created = result.created.map((p) => path.relative(session.workspaceDir, p));

    return { created, manifest_diff };
  },
};
