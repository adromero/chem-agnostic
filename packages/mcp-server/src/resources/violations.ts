// ---------------------------------------------------------------------------
// `architecture://violations` — returns the manifest + import-analyzer
// diagnostic list as JSON. Refreshed on every read; subscribed clients are
// notified when ANY workspace.yaml or compound.yaml changes (any source-of-
// truth edit can change the violation set).
//
// Internally delegates to the same `gatherViolations` helper used by the
// `find_violations` MCP tool — guaranteeing tool and resource never drift.
// ---------------------------------------------------------------------------

import type { Session } from "../context.js";
import { gatherViolations } from "../tools/_gather-violations.js";

export const VIOLATIONS_URI = "architecture://violations";

export async function readViolations(
  session: Session,
): Promise<{ uri: string; mimeType: string; text: string }> {
  const diagnostics = await gatherViolations(session);
  return {
    uri: VIOLATIONS_URI,
    mimeType: "application/json",
    text: JSON.stringify({ diagnostics, total: diagnostics.length }, null, 2),
  };
}
