// ---------------------------------------------------------------------------
// Helpers for downstream packages that want to spin up a real chemag MCP
// server in their own integration tests. Keeping these in the published
// surface means downstream test fixtures don't need to fork our server
// wiring or import internal modules.
// ---------------------------------------------------------------------------

export { createServer, type CreateServerOptions, type ServerHandle } from "./server.js";
export { Session, type SessionOptions } from "./context.js";
