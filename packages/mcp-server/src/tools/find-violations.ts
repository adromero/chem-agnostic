// ---------------------------------------------------------------------------
// `find_violations` — run the manifest checks + import analyzer and return
// the diagnostic list, optionally filtered to a single compound or to files
// changed since a given git revision.
//
// The actual pipeline lives in `_gather-violations.ts` so the MCP resource
// `architecture://violations` (WP-016) reuses the exact same code path —
// the diagnostic arrays they return are byte-for-byte identical for the
// same input.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { Diagnostic } from "@chemag/core/types";
import type { Session } from "../context.js";
import { gatherViolations } from "./_gather-violations.js";
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
    const all = await gatherViolations(session, {
      compound: input.compound,
      since: input.since,
    });
    const total = all.length;
    const truncated = total > MAX_DIAGNOSTICS;
    const diagnostics = truncated ? all.slice(0, MAX_DIAGNOSTICS) : all;
    return { diagnostics, total, truncated };
  },
};
