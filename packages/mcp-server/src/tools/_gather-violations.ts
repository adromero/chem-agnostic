// ---------------------------------------------------------------------------
// Shared violation-gathering pipeline used by both:
//   * `find_violations` MCP tool   (packages/mcp-server/src/tools/find-violations.ts)
//   * `architecture://violations` resource  (packages/mcp-server/src/resources/violations.ts)
//
// One source of truth for "run the manifest checks + import analyzer and
// optionally filter by compound or by changed files since a git revision."
// Diagnostic arrays returned to either consumer are byte-for-byte identical
// for the same input.
//
// The underscore-prefixed filename signals tool-private status: this module
// is wired through tools/index.ts only via direct imports — it does NOT add
// itself to ALL_TOOLS.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { allChecks } from "@chemag/core/checks";
import { findChangedFiles } from "@chemag/core/git-utils";
import { checkImports } from "@chemag/core/import-check";
import type { Diagnostic } from "@chemag/core/types";
import type { Session } from "../context.js";
import { resolvePlugin } from "./plugin-resolver.js";

export interface GatherViolationsOptions {
  /** Restrict the result to a single compound by name. */
  compound?: string;
  /**
   * Restrict the result to diagnostics whose `file` lives within the set of
   * files changed since the given git revision (via git diff --name-only).
   */
  since?: string;
}

/**
 * Run the manifest-level checks + import-level analysis for a session's
 * workspace and return the merged Diagnostic list, optionally filtered.
 * Errors propagate to the caller — both the tool and the resource map them
 * onto their respective error envelopes.
 */
export async function gatherViolations(
  session: Session,
  opts: GatherViolationsOptions = {},
): Promise<Diagnostic[]> {
  const workspace = await session.loadWorkspace();
  const compounds = await session.listCompounds();
  const plugin = resolvePlugin(workspace);

  const manifestDiagnostics: Diagnostic[] = [];
  for (const { fn } of allChecks) {
    const out = fn(workspace, compounds, { manifestOnly: false });
    manifestDiagnostics.push(...out);
  }
  const importDiagnostics = checkImports(workspace, compounds, plugin);
  let all: Diagnostic[] = [...manifestDiagnostics, ...importDiagnostics];

  if (opts.compound) {
    const target = compounds.find((c) => c.manifest.compound === opts.compound);
    const compoundDir = target ? path.resolve(target.dir) : null;
    all = all.filter((d) => {
      if (d.compound === opts.compound) return true;
      if (d.file && compoundDir) {
        const abs = path.resolve(d.file);
        return abs === compoundDir || abs.startsWith(`${compoundDir}${path.sep}`);
      }
      return false;
    });
  }

  if (opts.since) {
    const changed = await findChangedFiles(opts.since, session.workspaceDir);
    const changedAbs = new Set(changed.map((f) => path.resolve(session.workspaceDir, f)));
    all = all.filter((d) => {
      if (!d.file) return false;
      return changedAbs.has(path.resolve(d.file));
    });
  }

  return all;
}
