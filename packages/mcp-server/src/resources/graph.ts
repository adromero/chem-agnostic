// ---------------------------------------------------------------------------
// `architecture://graph.mermaid` — workspace-wide Mermaid dependency graph.
//
// Returned as `text/markdown` (Mermaid is conventionally embedded in
// markdown). Clients can render this directly in Claude Desktop or paste it
// into a Mermaid live preview.
// ---------------------------------------------------------------------------

import { generateMermaid } from "@chemag/core/graph";
import type { Session } from "../context.js";

export const GRAPH_URI = "architecture://graph.mermaid";

export async function readGraph(
  session: Session,
): Promise<{ uri: string; mimeType: string; text: string }> {
  const ws = await session.loadWorkspace();
  const compounds = await session.listCompounds();
  const mermaid = generateMermaid(ws, compounds);
  return {
    uri: GRAPH_URI,
    mimeType: "text/markdown",
    // Wrap in a fenced code block so the body is valid markdown standalone.
    text: `\`\`\`mermaid\n${mermaid}\`\`\`\n`,
  };
}
