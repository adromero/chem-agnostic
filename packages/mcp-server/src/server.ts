// ---------------------------------------------------------------------------
// `createServer` — instantiates the chemag MCP server with the capability
// flags promised by WP-014 and wires it to a per-session state container.
//
// As of WP-016 this also wires the resource registry (resources/list,
// resources/read, resources/templates/list) and the subscription pipeline:
//
//   * `registerResources(...)` registers all 6 architecture URIs.
//   * The chokidar-backed `Watcher` is created lazily on first subscribe;
//     today we create it eagerly because `registerResources` installs the
//     watcher → cache-invalidation → notification chain at wire-up time.
//   * `SubscribeRequestSchema` and `UnsubscribeRequestSchema` are wired
//     onto the inner low-level `Server` — `McpServer` does NOT install
//     these handlers itself, despite the advertised
//     `capabilities.resources.subscribe = true` flag.
//   * `dispose()` releases every subscription owned by the session, closes
//     the subscription manager's debounce timers, and tears down the
//     watcher (the watcher close is owned by `Session.dispose()`).
//
// Privacy note (WP-006): the MCP server intentionally does NOT emit
// telemetry per tool/resource call. Only the CLI's `chemag mcp` startup may
// emit one event (in cli.ts), and only when the user has consented.
// ---------------------------------------------------------------------------

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  type ServerCapabilities,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { VocabularyName } from "@chemag/core/vocabulary";
import { Session, type SessionOptions } from "./context.js";
import { registerResources } from "./resources/index.js";
import { createSubscriptionManager, type SubscriptionManager } from "./subscriptions.js";
import { registerTools } from "./tools/index.js";
import { VERSION } from "./version.js";
import { createWatcher, type Watcher } from "./watcher.js";

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
  /**
   * When false, the server skips the chokidar watcher and the resource
   * subscription pipeline. Used by tests that don't want a live filesystem
   * watcher running. Resource reads still work; resources/subscribe still
   * registers, but notifications never fire because nothing is watching.
   * Default: true.
   */
  enableWatcher?: boolean;
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
  /** The active subscription manager (test hook; do not rely in production). */
  subscriptionManager: SubscriptionManager;
  /** Connect to a transport and start handling messages. */
  connect(transport: Transport): Promise<void>;
  /** Close the underlying connection and dispose the session. */
  dispose(): Promise<void>;
}

/**
 * Capability flags advertised on the initialize handshake. The advertised
 * `resources.subscribe = true` is now backed by real handlers (WP-016).
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
        "and resources (workspace, compound, violations, graph, docs) to MCP-aware " +
        "clients. Subscribe to architecture://* URIs to receive change notifications.",
    },
  );

  // Empty `prompts/list` placeholder — prompts ship in a follow-on ticket.
  server.server.setRequestHandler(EmptyPromptListSchema, async () => ({ prompts: [] }));

  // Wire the tool registry — this installs the SDK's own `tools/list` and
  // `tools/call` handlers via `setToolRequestHandlers`. Do NOT also call
  // `setRequestHandler('tools/list', ...)` here; the SDK's installation is
  // authoritative.
  registerTools(server, session);

  // Subscription manager — pure module, transport-agnostic. The notifier
  // closure is the ONLY place that knows about the SDK transport. We use
  // `server.server.sendResourceUpdated`, NOT `McpServer` (which does not
  // expose that API).
  const subscriptionManager = createSubscriptionManager({
    notifier: (uri) => {
      // Fire-and-forget; the transport may be closing. Swallow + ignore.
      server.server.sendResourceUpdated({ uri }).catch(() => {
        // Transport hiccup — non-fatal.
      });
    },
  });

  // Spin up the file watcher (optional) and wire the resource registry
  // (always). The watcher is the data source for `notifications/resources/
  // updated`; tests can pass `enableWatcher: false` to skip the OS-level
  // watch surface — resource reads still work, subscriptions register
  // (criterion #16), and the only thing that doesn't happen is the
  // watcher → notify pipeline (no notifications fire). When the watcher
  // is disabled we install a no-op watcher so the resources/index can
  // still attach a (silent) onChange handler.
  const wantWatcher = opts.enableWatcher !== false;
  const watcher = wantWatcher
    ? createWatcher(session.workspaceDir, {
        // We don't read the manifest_filename from workspace.yaml here because
        // the watcher is constructed BEFORE loadWorkspace() runs. The default
        // ("compound.yaml") matches every workspace shipped today; non-default
        // manifest names will be picked up via re-init in a follow-on patch.
        manifestFilename: "compound.yaml",
      })
    : createNoopWatcher();
  session.watcher = watcher;
  registerResources(server, session, watcher, subscriptionManager);

  // Subscribe / Unsubscribe handlers — wired explicitly because McpServer
  // does NOT install these despite the capability flag. Without these the
  // client gets MethodNotFound on resources/subscribe.
  server.server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    subscriptionManager.subscribe(request.params.uri, session.id);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    subscriptionManager.unsubscribe(request.params.uri, session.id);
    return {};
  });

  return {
    server,
    session,
    subscriptionManager,
    async connect(transport: Transport): Promise<void> {
      await server.connect(transport);
    },
    async dispose(): Promise<void> {
      try {
        // Drop subscriptions BEFORE the transport closes — otherwise a
        // pending notifier call may fire on a half-closed transport.
        subscriptionManager.releaseSession(session.id);
        subscriptionManager.close();
        await server.close();
      } finally {
        // Session.dispose() closes the watcher (fire-and-forget).
        session.dispose();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tiny inline zod-like schema stand-in for the prompts/list placeholder.
//
// The MCP SDK's setRequestHandler signature wants something with a `parse`
// method that yields the request body. The prompts/list placeholder doesn't
// need to validate anything (the SDK already verified the JSON-RPC envelope),
// so we ship the minimal schema that picks the request method by literal-
// equality.
//
// `EmptyResourceListSchema` was REMOVED in WP-016 — `registerResources` now
// installs the SDK's authoritative resources/list handler.
// ---------------------------------------------------------------------------

const EmptyPromptListSchema = makeMethodSchema("prompts/list");

/**
 * Watcher stub for `enableWatcher: false`. Honors the public Watcher API
 * but never emits a change event. Used by tests that don't want a chokidar
 * instance running.
 */
function createNoopWatcher(): Watcher {
  return {
    onChange: () => () => {},
    ready: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

function makeMethodSchema(method: string) {
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
  } as unknown as never;
}
