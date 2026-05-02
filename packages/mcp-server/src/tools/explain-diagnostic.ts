// ---------------------------------------------------------------------------
// `explain_diagnostic` — surface a single CHEM-XXX-NNN diagnostic-code's
// description, level, doc URL, and (eventually) examples.
//
// Examples are deliberately optional + defaulted to `[]`. `DiagnosticCodeMeta`
// does not yet carry an `examples` field; population is deferred to a future
// docs stage so the schema reservation here is purely additive.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { DIAGNOSTIC_CODES, type DiagnosticCode, docLinkFor } from "@chemag/core/diagnostics";
import { tr } from "@chemag/core/vocabulary";
import type { Session } from "../context.js";
import type { Tool } from "./types.js";

const inputSchema = {
  code: z.string().min(1, "code is required"),
};

export interface ExplainDiagnosticOutput {
  code: string;
  description: string;
  level: "error" | "warning";
  doc_url: string;
  examples: string[];
}

export const explainDiagnosticTool: Tool<typeof inputSchema, ExplainDiagnosticOutput> = {
  name: "explain_diagnostic",
  description:
    "Look up a chemag diagnostic code (CHEM-CATEGORY-NNN) and return its plain-English description, severity level, and a docs URL. The `examples` array is reserved for a future docs stage and currently returns an empty array.",
  inputSchema,
  async handler(input, _session: Session): Promise<ExplainDiagnosticOutput> {
    const meta = (DIAGNOSTIC_CODES as Record<string, (typeof DIAGNOSTIC_CODES)[DiagnosticCode]>)[
      input.code
    ];
    if (!meta) throw new Error(`Unknown diagnostic code: "${input.code}".`);

    return {
      code: meta.code,
      description: humanDescription(meta.code, meta.trKey),
      level: meta.level,
      doc_url: docLinkFor(meta),
      examples: [],
    };
  },
};

/**
 * Best-effort human description: read the active vocabulary entry, then
 * normalize the `{param}` placeholders to `<value>` so the result reads as
 * a generic explanation instead of a templated message. Falls back to the
 * trKey identifier when the locale lookup throws.
 */
function humanDescription(_code: string, trKey: string): string {
  try {
    const raw = tr(trKey as Parameters<typeof tr>[0], {});
    return raw.replace(/\{[^}]+\}/g, "<value>").trim();
  } catch {
    return trKey;
  }
}
