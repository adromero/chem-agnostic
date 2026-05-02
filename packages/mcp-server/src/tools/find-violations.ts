// ---------------------------------------------------------------------------
// `find_violations` — run the manifest checks + import analyzer and return
// the diagnostic list, optionally filtered to a single compound or to files
// changed since a given git revision.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { z } from "zod";
import { allChecks } from "@chemag/core/checks";
import { findChangedFiles } from "@chemag/core/git-utils";
import { checkImports } from "@chemag/core/import-check";
import type { Diagnostic } from "@chemag/core/types";
import type { Session } from "../context.js";
import { resolvePlugin } from "./plugin-resolver.js";
import type { Tool } from "./types.js";

const inputSchema = {
  since: z.string().optional(),
  compound: z.string().optional(),
};

const MAX_DIAGNOSTICS = 200;

export interface FindViolationsOutput {
  diagnostics: Diagnostic[];
  total: number;
  truncated: boolean;
}

export const findViolationsTool: Tool<typeof inputSchema, FindViolationsOutput> = {
  name: "find_violations",
  description:
    "Run manifest validation and import analysis across the workspace. Optionally filter to a single compound, or to files that changed since a git revision (via git diff --name-only).",
  inputSchema,
  async handler(input, session: Session): Promise<FindViolationsOutput> {
    const workspace = await session.loadWorkspace();
    const compounds = await session.listCompounds();
    const plugin = resolvePlugin(workspace);

    const manifestDiagnostics: Diagnostic[] = [];
    for (const { fn } of allChecks) {
      const out = fn(workspace, compounds, { manifestOnly: false });
      manifestDiagnostics.push(...out);
    }
    const importDiagnostics = checkImports(workspace, compounds, plugin);

    let all = [...manifestDiagnostics, ...importDiagnostics];

    // Compound filter — keep diagnostics that target the named compound, OR
    // whose `file` lives under the compound's directory.
    if (input.compound) {
      const target = compounds.find((c) => c.manifest.compound === input.compound);
      const compoundDir = target ? path.resolve(target.dir) : null;
      all = all.filter((d) => {
        if (d.compound === input.compound) return true;
        if (d.file && compoundDir) {
          const abs = path.resolve(d.file);
          return abs === compoundDir || abs.startsWith(`${compoundDir}${path.sep}`);
        }
        return false;
      });
    }

    // `since` filter — keep diagnostics whose `file` is in the changed-files
    // set. Diagnostics without a `file` (workspace-level findings) are
    // dropped under this filter, on the assumption that an explicit `since`
    // means "what did I just touch".
    if (input.since) {
      const changed = await findChangedFiles(input.since, session.workspaceDir);
      const changedAbs = new Set(changed.map((f) => path.resolve(session.workspaceDir, f)));
      all = all.filter((d) => {
        if (!d.file) return false;
        return changedAbs.has(path.resolve(d.file));
      });
    }

    const total = all.length;
    const truncated = total > MAX_DIAGNOSTICS;
    const diagnostics = truncated ? all.slice(0, MAX_DIAGNOSTICS) : all;

    return { diagnostics, total, truncated };
  },
};
