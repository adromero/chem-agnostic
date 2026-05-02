// ---------------------------------------------------------------------------
// Tool registry — wires each tool's name, plain-English description, zod
// raw shape, and handler through the SDK's `server.registerTool` API.
//
// Decisions:
//   * Descriptions are inline plain English (vocabulary-invariant), NOT
//     routed through `tr()`. They're consumed by IDEs/agents, not end
//     users — duplicating snapshots across vocabularies for no benefit
//     would be the wrong trade-off.
//   * Diagnostic strings INSIDE tool responses still go through `tr()`.
//   * Schema translation is delegated to the SDK's zod-shape support
//     (`registerTool({ inputSchema: <shape> }, ...)`). The
//     `zod-to-json-schema` dep is declared as a fallback in package.json
//     but is not currently used at runtime.
//   * Errors thrown by handlers are caught here and converted to
//     CHEM-MCP-103 (tool_handler_failed) MCP responses with `isError: true`.
//     Zod parse failures are caught the same way and re-tagged as
//     CHEM-MCP-101 (tool_input_invalid).
// ---------------------------------------------------------------------------

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { tr } from "@chemag/core/vocabulary";
import type { Session } from "../context.js";
import { explainDiagnosticTool } from "./explain-diagnostic.js";
import { findViolationsTool } from "./find-violations.js";
import { getBondRulesTool } from "./get-bond-rules.js";
import { getCompoundTool } from "./get-compound.js";
import { listCompoundsTool } from "./list-compounds.js";
import { scaffoldUnitTool } from "./scaffold-unit.js";
import type { Tool } from "./types.js";
import { validateEditTool } from "./validate-edit.js";
import { whereShouldThisGoTool } from "./where-should-this-go.js";

/** Ordered list of every tool the chemag MCP server exposes. */
export const ALL_TOOLS: ReadonlyArray<Tool<ZodRawShape, unknown>> = [
  whereShouldThisGoTool,
  validateEditTool,
  listCompoundsTool,
  getCompoundTool,
  getBondRulesTool,
  findViolationsTool,
  explainDiagnosticTool,
  scaffoldUnitTool,
] as const;

/** Wire every tool in `ALL_TOOLS` into an MCP server. */
export function registerTools(server: McpServer, session: Session): void {
  for (const tool of ALL_TOOLS) {
    registerOne(server, session, tool);
  }
}

function registerOne(server: McpServer, session: Session, tool: Tool<ZodRawShape, unknown>): void {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    async (rawArgs: unknown) => {
      // Parse via zod (with the fully-built object schema) so we can map
      // failures to CHEM-MCP-101. The SDK pre-validates against the raw
      // shape; this defense-in-depth pass guarantees the message comes
      // from our diagnostic layer with the right code.
      const objectSchema = z.object(tool.inputSchema);
      const parsed = objectSchema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        const reason = formatZodError(parsed.error);
        const message = tr("diagnostic.tool_input_invalid", {
          tool: tool.name,
          reason,
        });
        return errorResult(`CHEM-MCP-101 ${message}`);
      }

      try {
        const out = await tool.handler(parsed.data as Parameters<typeof tool.handler>[0], session);
        const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: typeof out === "string" ? undefined : (out as Record<string, unknown>),
        };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const message = tr("diagnostic.tool_handler_failed", {
          tool: tool.name,
          reason,
        });
        return errorResult(`CHEM-MCP-103 ${message}`);
      }
    },
  );
}

function errorResult(text: string): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

function formatZodError(error: z.ZodError): string {
  const issues = error.issues.map((i) => {
    const where = i.path.length > 0 ? i.path.join(".") : "(root)";
    return `${where}: ${i.message}`;
  });
  return issues.join("; ");
}
