// ---------------------------------------------------------------------------
// JSON-RPC envelope helpers.
//
// The @modelcontextprotocol/sdk takes care of framing, schema validation,
// and request/response routing. This file is intentionally minimal — it
// exists so future helpers (custom error mapping, telemetry adapters,
// elicitation wrappers) have an obvious home without cluttering server.ts.
//
// Today it only re-exports the SDK's `McpServer` and `Transport` types so
// downstream consumers can import them from "@chemag/mcp-server" without
// taking a hard dependency on the SDK module path.
// ---------------------------------------------------------------------------

export type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
