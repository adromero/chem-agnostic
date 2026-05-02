// ---------------------------------------------------------------------------
// Transport selection for the chemag MCP server.
//
// v1.0 ships stdio only — the canonical transport for MCP-aware clients
// running on the same machine as the CLI (Claude Desktop, Cursor, IDE
// plugins). SSE/streamable HTTP is reserved for v1.0.x once the cloud
// surface lands; until then `createSseTransport` throws CHEM-MCP-002 so
// callers receive a vocabulary-aware error instead of a stack trace.
// ---------------------------------------------------------------------------

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { tr } from "@chemag/core/vocabulary";

/** Supported transport identifiers — keep in sync with the CLI flag parser. */
export type TransportName = "stdio" | "sse";

/**
 * Construct the stdio transport — process.stdin / process.stdout. The MCP
 * SDK manages framing (newline-delimited JSON-RPC); this wrapper only exists
 * so the rest of the package never touches the SDK's internal module path.
 */
export function createStdioTransport(): Transport {
  return new StdioServerTransport();
}

/**
 * SSE transport is intentionally unimplemented in v1.0. Throws an error
 * carrying the CHEM-MCP-002 diagnostic message in the active vocabulary.
 *
 * TODO(track-5): wire the SDK's SSE / streamable-HTTP transport once the
 * cloud worker surface (WP-027+) is ready to host it.
 */
export function createSseTransport(): Transport {
  const message = tr("diagnostic.mcp_transport_unsupported", { transport: "sse" });
  throw new Error(message);
}

/**
 * Resolve a transport name to a fresh transport instance, or throw with the
 * vocabulary-aware error for anything we don't support yet.
 */
export function createTransport(name: TransportName): Transport {
  if (name === "stdio") return createStdioTransport();
  if (name === "sse") return createSseTransport();
  // Exhaustiveness guard — TypeScript narrows `name` to `never` here.
  const exhaustive: never = name;
  throw new Error(tr("diagnostic.mcp_transport_unsupported", { transport: String(exhaustive) }));
}
