// ---------------------------------------------------------------------------
// `validate_edit` — thin wrapper over `runCheckEdit` from @chemag/core.
//
// Inputs:
//   file: workspace-relative or absolute path to the file under review
//   new_content?: hypothetical content (e.g. about-to-be-saved buffer)
//   proposed_role?: role override for placement resolution
//   proposed_compound?: compound override for placement resolution
//
// Output:
//   { valid, diagnostics, remediation? }
// ---------------------------------------------------------------------------

import { z } from "zod";
import { runCheckEdit } from "@chemag/core/check-edit";
import type { Diagnostic, DiagnosticRemediation } from "@chemag/core/types";
import type { Session } from "../context.js";
import { resolvePlugin } from "./plugin-resolver.js";
import type { Tool } from "./types.js";

const inputSchema = {
  file: z.string().min(1, "file is required"),
  new_content: z.string().optional(),
  proposed_role: z.string().optional(),
  proposed_compound: z.string().optional(),
};

export interface ValidateEditOutput {
  valid: boolean;
  diagnostics: Diagnostic[];
  remediation?: DiagnosticRemediation;
}

export const validateEditTool: Tool<typeof inputSchema, ValidateEditOutput> = {
  name: "validate_edit",
  description:
    "Validate a single file edit against Chem architecture rules (bond rules, cross-compound import rules, role-folder placement). Returns diagnostics with structured remediation hints.",
  inputSchema,
  async handler(input, session: Session): Promise<ValidateEditOutput> {
    const workspace = await session.loadWorkspace();
    const compounds = await session.listCompounds();
    const plugin = resolvePlugin(workspace);

    const result = runCheckEdit({
      workspace,
      workspaceDir: session.workspaceDir,
      compounds,
      plugin,
      filePath: input.file,
      content: input.new_content,
      proposedRole: input.proposed_role,
      proposedCompound: input.proposed_compound,
    });

    const diagnostics = result.diagnostics;
    const valid = !diagnostics.some((d) => d.level === "error");
    // Surface the first remediation we find, if any. Per-diagnostic remediations
    // also remain on each diagnostic object so callers can do their own walk.
    const remediation = diagnostics.find((d) => d.remediation)?.remediation;
    return { valid, diagnostics, ...(remediation ? { remediation } : {}) };
  },
};
