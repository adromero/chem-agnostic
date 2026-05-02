// ---------------------------------------------------------------------------
// Common types for the chemag MCP tool layer (wp-015).
//
// Each tool exports a `Tool` object that carries:
//   * `name`        — identifier used in the MCP `tools/list` registry
//   * `description` — plain-English (vocabulary-invariant) blurb (≤2 sentences)
//   * `inputSchema` — zod raw shape (Record<string, ZodSchema>) accepted by
//     the SDK's `registerTool`
//   * `handler`     — Promise-returning function that produces the tool's
//     structured output. Errors map to MCP error responses in the registry.
//
// Descriptions are deliberately NOT routed through `tr()` — they're
// vocabulary-invariant and consumed by IDEs/agents, so duplicating snapshots
// across vocabularies for no user benefit is the wrong trade. Diagnostic
// strings inside tool RESPONSES still go through `tr()`.
// ---------------------------------------------------------------------------

import type { z, ZodRawShape } from "zod";
import type { Session } from "../context.js";

/** Generic tool record. `Input` is the inferred shape of `inputSchema`. */
export interface Tool<Shape extends ZodRawShape = ZodRawShape, Output = unknown> {
  /** Snake_case tool name as it appears in MCP `tools/list`. */
  readonly name: string;
  /** Plain-English description, ≤2 sentences. */
  readonly description: string;
  /**
   * zod raw shape — the SDK's `registerTool` accepts this directly and
   * handles JSON-Schema conversion internally (preferred over the
   * `zod-to-json-schema` fallback).
   */
  readonly inputSchema: Shape;
  /**
   * Tool handler. Throws to signal a handler-level failure (the registry
   * maps the exception to an `isError: true` MCP response with a
   * CHEM-MCP-103 diagnostic message); zod parse failures are caught
   * upstream and mapped to CHEM-MCP-101.
   */
  handler(input: z.infer<z.ZodObject<Shape>>, session: Session): Promise<Output>;
}
