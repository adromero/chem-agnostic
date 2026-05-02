// ---------------------------------------------------------------------------
// Public surface of @chemag/mcp-server. Inter-package consumers (today:
// @chemag/cli's `chemag mcp` command) import from this barrel only.
// ---------------------------------------------------------------------------

export {
  SERVER_CAPABILITIES,
  createServer,
  type CreateServerOptions,
  type ServerHandle,
} from "./server.js";

export {
  Session,
  type SessionOptions,
} from "./context.js";

export {
  createSseTransport,
  createStdioTransport,
  createTransport,
  type TransportName,
} from "./transport.js";

export type { McpServer, Transport } from "./protocol.js";

export { VERSION } from "./version.js";

export { ALL_TOOLS, registerTools } from "./tools/index.js";
