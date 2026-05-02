// ---------------------------------------------------------------------------
// `architecture://workspace` — returns the parsed workspace.yaml as JSON.
//
// Static URI. Subscribed clients are notified whenever workspace.yaml itself
// changes. Compound edits do NOT bubble up to this URI.
// ---------------------------------------------------------------------------

import type { Session } from "../context.js";

export const WORKSPACE_URI = "architecture://workspace";

/** Read handler for the workspace resource. Returns a single text/json content. */
export async function readWorkspace(
  session: Session,
): Promise<{ uri: string; mimeType: string; text: string }> {
  const ws = await session.loadWorkspace();
  return {
    uri: WORKSPACE_URI,
    mimeType: "application/json",
    text: JSON.stringify(ws, null, 2),
  };
}
