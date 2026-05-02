// ---------------------------------------------------------------------------
// `createServer` — instantiates the chemag MCP server with the capability
// flags promised by WP-014 and wires it to a per-session state container.
//
// This stage scaffolds the server identity, capability surface, and session
// lifecycle. Concrete tool, resource, and prompt handlers land in WP-015,
// WP-016, and follow-on tickets respectively. The capability flags are
// advertised now so MCP-aware clients see the right shape during the
// handshake — they get an empty `resources/list` payload until the
// resource handlers ship.
//
// Privacy note (WP-006): the MCP server intentionally does NOT emit
// telemetry per tool call. Per-call telemetry would leak workspace
// internals to operators of an opt-in metrics endpoint. Only the CLI's
// `chemag mcp` startup may emit one event (in cli.ts), and only when the
// user has consented.
// ---------------------------------------------------------------------------

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";
import type { VocabularyName } from "@chemag/core/vocabulary";
import { Session, type SessionOptions } from "./context.js";
import { registerTools } from "./tools/index.js";
import { VERSION } from "./version.js";

/** Options accepted by `createServer`. */
export interface CreateServerOptions {
  /**
   * Workspace directory (the directory containing workspace.yaml). The
   * server will lazily resolve the workspace via the @chemag/core loader
   * the first time a request needs it. Defaults to `process.cwd()`.
   */
  workspaceUri?: string;
  /**
   * Optional vocabulary hint from the client. Applied at the
   * Phase-1.5 "session" rank — workspace.yaml still wins.
   */
  vocabulary?: VocabularyName;
  /**
   * Optional client name (typically `clientInfo.name` from the MCP
   * `initialize` request). Stored for debugging / logging only.
   */
  clientName?: string;
}

/**
 * Aggregate returned by `createServer`. Callers connect the `transport`
 * via `server.connect(transport)` and call `dispose()` when the connection
 * closes to release session state.
 */
export interface ServerHandle {
  /** The MCP server instance, ready to bind to a transport. */
  server: McpServer;
  /** The per-connection session state. */
  session: Session;
  /** Connect to a transport and start handling messages. */
  connect(transport: Transport): Promise<void>;
  /** Close the underlying connection and dispose the session. */
  dispose(): Promise<void>;
}

/**
 * Capability flags advertised on the initialize handshake. Resources and
 * prompts are stubbed — handler code lands in WP-016+. Tools is an empty
 * object today (WP-015 fills it in). The shape — not the contents — is
 * what the client uses to gate its UI.
 */
export const SERVER_CAPABILITIES: ServerCapabilities = {
  tools: {},
  resources: { subscribe: true, listChanged: true },
  prompts: {},
};

/**
 * Construct a chemag MCP server. The returned `server` is not yet bound to
 * a transport — call `handle.connect(transport)` to start serving.
 */
export function createServer(opts: CreateServerOptions = {}): ServerHandle {
  const sessionOpts: SessionOptions = {
    workspaceDir: opts.workspaceUri ?? process.cwd(),
    vocabulary: opts.vocabulary,
    clientName: opts.clientName,
  };
  const session = new Session(sessionOpts);

  const server = new McpServer(
    {
      name: "chemag",
      version: VERSION,
    },
    {
      capabilities: SERVER_CAPABILITIES,
      instructions:
        "chemag MCP server — exposes Chem architecture tools (check, analyze, scaffold) " +
        "to MCP-aware clients. Tool implementations land in WP-015 and beyond; today the " +
        "server only handles the initialization handshake.",
    },
  );

  // Register an empty `resources/list` handler so clients that probe the
  // resources surface during initialization get a well-formed response.
  // Concrete resource definitions land in WP-016.
  server.server.setRequestHandler(EmptyResourceListSchema, async () => ({ resources: [] }));

  // Likewise, an empty `prompts/list` so prompt-capable clients don't hang.
  server.server.setRequestHandler(EmptyPromptListSchema, async () => ({ prompts: [] }));

  // Wire the tool registry — this installs the SDK's own `tools/list` and
  // `tools/call` handlers via `setToolRequestHandlers`. Do NOT also call
  // `setRequestHandler('tools/list', ...)` here; the SDK's installation is
  // authoritative.
  registerTools(server, session);

  return {
    server,
    session,
    async connect(transport: Transport): Promise<void> {
      await server.connect(transport);
    },
    async dispose(): Promise<void> {
      try {
        await server.close();
      } finally {
        session.dispose();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tiny inline zod-like schema stand-ins.
//
// The MCP SDK's setRequestHandler signature wants something with a `parse`
// method that yields the request body. We don't need to validate anything
// here (the SDK already verified the JSON-RPC envelope), so we ship the
// minimal schema that picks the request method by literal-equality. This
// avoids a hard zod dep at our layer and keeps the bundle small.
//
// The schema shape here mirrors zod's inference contract just closely
// enough for the SDK's generic constraint to be happy.
// ---------------------------------------------------------------------------

const EmptyResourceListSchema = makeMethodSchema("resources/list");
const EmptyPromptListSchema = makeMethodSchema("prompts/list");

function makeMethodSchema(method: string) {
  // Cast: the SDK accepts any object schema with a `parse` method whose
  // output has a `method` discriminant. We do the bare minimum.
  return {
    _def: { typeName: "ZodObject" as const },
    shape: {
      method: { _def: { typeName: "ZodLiteral" as const, value: method } },
    },
    parse(input: unknown): { method: string; params?: unknown } {
      const obj = input as { method?: string; params?: unknown };
      if (obj.method !== method) {
        throw new Error(`Expected method "${method}", got "${obj.method}"`);
      }
      return { method, params: obj.params };
    },
    // The SDK's generic constraint expects a zod-shaped schema; we satisfy
    // the structural minimum and cast through `unknown` because no typed
    // shape on our side can describe the SDK's heavily-overloaded generic
    // constraint without pulling in zod itself.
  } as unknown as never;
}
