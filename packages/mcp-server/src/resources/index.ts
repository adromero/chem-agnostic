// ---------------------------------------------------------------------------
// Resource registry — wires every chemag MCP resource into an `McpServer`,
// connects the watcher → cache-invalidation → subscription-manager pipeline,
// and maps internal CHEM-MCP-301/302/303 errors onto the SDK's
// `ReadResourceResult` shape.
//
// URI map (matches the test criteria in WP-016):
//   * architecture://workspace                                static
//   * architecture://compound/{name}                          template
//   * architecture://compound/{name}/public-surface           template
//   * architecture://violations                               static
//   * architecture://graph.mermaid                            static
//   * architecture://docs/{section}                           template
//
// MCP error mapping. The SDK's read-resource path returns content; to surface
// an error we set `isError: true` on the result and put the diagnostic text
// in the body. (The wrapper schema also accepts an `_meta` slot, but plain-
// text remains the most consumer-portable.)
// ---------------------------------------------------------------------------

import {
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { tr } from "@chemag/core/vocabulary";
import type { Session } from "../context.js";
import type { SubscriptionManager } from "../subscriptions.js";
import type { Watcher, WatcherChange } from "../watcher.js";
import { compoundUri, ResourceCompoundNotFoundError, readCompound } from "./compound.js";
import {
  DOCS_SECTIONS,
  ResourceDocsSectionUnknownError,
  docsUri,
  readDocs,
} from "./docs.js";
import { GRAPH_URI, readGraph } from "./graph.js";
import { publicSurfaceUri, readPublicSurface } from "./public-surface.js";
import { VIOLATIONS_URI, readViolations } from "./violations.js";
import { WORKSPACE_URI, readWorkspace } from "./workspace.js";

/** Map a thrown error to an MCP-friendly text/error envelope. */
function errorEnvelope(uri: string, code: string, message: string) {
  return {
    contents: [
      {
        uri,
        mimeType: "text/plain",
        text: `${code} ${message}`,
      },
    ],
    isError: true,
  };
}

function asError(err: unknown): { code: string; message: string } {
  if (err instanceof ResourceCompoundNotFoundError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof ResourceDocsSectionUnknownError) {
    return { code: err.code, message: err.message };
  }
  // Generic failure — surface as CHEM-MCP-301 with a best-effort message.
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "unknown error";
  return { code: "CHEM-MCP-301", message };
}

/**
 * Wire every resource into the supplied server. The subscription manager
 * pipeline is also installed here: watcher events → cache invalidation →
 * subscriptionManager.notifyChange(uri).
 */
export function registerResources(
  server: McpServer,
  session: Session,
  watcher: Watcher,
  subscriptionManager: SubscriptionManager,
): void {
  // ---- Static resources ----
  server.registerResource(
    "workspace",
    WORKSPACE_URI,
    {
      title: "Workspace manifest",
      description: "Parsed workspace.yaml as JSON.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const out = await readWorkspace(session);
        return { contents: [out] };
      } catch (err) {
        const e = asError(err);
        return errorEnvelope(uri.toString(), e.code, e.message);
      }
    },
  );

  server.registerResource(
    "violations",
    VIOLATIONS_URI,
    {
      title: "Architecture violations",
      description: "Manifest + import-analyzer diagnostics for the workspace.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const out = await readViolations(session);
        return { contents: [out] };
      } catch (err) {
        const e = asError(err);
        return errorEnvelope(uri.toString(), e.code, e.message);
      }
    },
  );

  server.registerResource(
    "graph",
    GRAPH_URI,
    {
      title: "Workspace dependency graph",
      description: "Mermaid diagram of all compounds and their imports.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      try {
        const out = await readGraph(session);
        return { contents: [out] };
      } catch (err) {
        const e = asError(err);
        return errorEnvelope(uri.toString(), e.code, e.message);
      }
    },
  );

  // ---- Templated resources ----
  server.registerResource(
    "compound",
    new ResourceTemplate("architecture://compound/{name}", {
      list: async () => {
        const compounds = await session.listCompounds();
        return {
          resources: compounds.map((c) => ({
            uri: compoundUri(c.manifest.compound),
            name: c.manifest.compound,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "Compound manifest",
      description: "Compound manifest by name.",
      mimeType: "application/json",
    },
    async (uri, vars) => {
      const name = singleVar(vars.name);
      if (!name) {
        const message = tr("diagnostic.resource_uri_invalid", {
          uri: uri.toString(),
          reason: "missing compound name",
        });
        return errorEnvelope(uri.toString(), "CHEM-MCP-301", message);
      }
      try {
        const out = await readCompound(session, name);
        return { contents: [out] };
      } catch (err) {
        const e = asError(err);
        return errorEnvelope(uri.toString(), e.code, e.message);
      }
    },
  );

  server.registerResource(
    "compound-public-surface",
    new ResourceTemplate("architecture://compound/{name}/public-surface", {
      list: async () => {
        const compounds = await session.listCompounds();
        return {
          resources: compounds.map((c) => ({
            uri: publicSurfaceUri(c.manifest.compound),
            name: `${c.manifest.compound}/public-surface`,
            mimeType: "text/plain",
          })),
        };
      },
    }),
    {
      title: "Compound public surface",
      description: "Symbols exported from a compound's public surface.",
      mimeType: "text/plain",
    },
    async (uri, vars) => {
      const name = singleVar(vars.name);
      if (!name) {
        const message = tr("diagnostic.resource_uri_invalid", {
          uri: uri.toString(),
          reason: "missing compound name",
        });
        return errorEnvelope(uri.toString(), "CHEM-MCP-301", message);
      }
      try {
        const out = await readPublicSurface(session, name);
        return { contents: [out] };
      } catch (err) {
        const e = asError(err);
        return errorEnvelope(uri.toString(), e.code, e.message);
      }
    },
  );

  server.registerResource(
    "docs",
    new ResourceTemplate("architecture://docs/{section}", {
      list: async () => ({
        resources: DOCS_SECTIONS.map((section) => ({
          uri: docsUri(section),
          name: `docs/${section}`,
          mimeType: "text/markdown",
        })),
      }),
    }),
    {
      title: "Documentation sections",
      description: "Workspace architecture documentation, by section.",
      mimeType: "text/markdown",
    },
    async (uri, vars) => {
      const section = singleVar(vars.section);
      if (!section) {
        const message = tr("diagnostic.resource_uri_invalid", {
          uri: uri.toString(),
          reason: "missing docs section",
        });
        return errorEnvelope(uri.toString(), "CHEM-MCP-301", message);
      }
      try {
        const out = await readDocs(session, section);
        return { contents: [out] };
      } catch (err) {
        const e = asError(err);
        return errorEnvelope(uri.toString(), e.code, e.message);
      }
    },
  );

  // ---- Watcher → cache → subscription pipeline ----
  watcher.onChange((change: WatcherChange) => {
    if (change.type === "workspace") {
      // Workspace.yaml changed — invalidate the workspace cache and notify
      // every URI whose body depends on workspace state.
      session.cache.invalidateWorkspace(change.path);
      // Drop in-memory memo so the next read re-discovers compounds too —
      // workspace.paths might have changed.
      session.invalidateLoadedWorkspace();
      subscriptionManager.notifyChange(WORKSPACE_URI);
      subscriptionManager.notifyChange(VIOLATIONS_URI);
      subscriptionManager.notifyChange(GRAPH_URI);
      for (const section of DOCS_SECTIONS) {
        subscriptionManager.notifyChange(docsUri(section));
      }
      return;
    }
    // type === "compound"
    session.cache.invalidateCompound(change.path);
    session.invalidateLoadedWorkspace();
    subscriptionManager.notifyChange(compoundUri(change.name));
    subscriptionManager.notifyChange(publicSurfaceUri(change.name));
    subscriptionManager.notifyChange(VIOLATIONS_URI);
    subscriptionManager.notifyChange(GRAPH_URI);
    // Compound edits don't change workspace.yaml, but the docs/types section
    // is built from the workspace and can't change either; the docs/tools
    // section is static. So we DON'T fire docs URIs on compound changes.
  });
}

function singleVar(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length === 1) return v[0];
  return undefined;
}

// Keep this re-export for the consumer code path (server.ts uses the
// ErrorCode enum to map exceptions) — not all code paths land here yet but
// keeping the import explicit avoids "unused import" lints.
export { ErrorCode, McpError };
