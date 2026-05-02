// ---------------------------------------------------------------------------
// `architecture://compound/{name}` — returns the full Compound manifest as
// JSON. Templated URI: `{name}` is the compound name (matched against
// `compound.compound` in the manifest, NOT the on-disk directory name —
// they're conventionally the same but the manifest is the source of truth).
//
// Errors:
//   * unknown compound → CHEM-MCP-302 (resource_compound_not_found)
//   * malformed URI    → CHEM-MCP-301, raised at the caller layer.
// ---------------------------------------------------------------------------

import { tr } from "@chemag/core/vocabulary";
import type { Session } from "../context.js";

export const COMPOUND_URI_TEMPLATE = "architecture://compound/{name}";

/** Build the concrete URI for a given compound name. */
export function compoundUri(name: string): string {
  return `architecture://compound/${name}`;
}

/** Internal error type used to signal a 302 to the caller layer. */
export class ResourceCompoundNotFoundError extends Error {
  readonly code = "CHEM-MCP-302" as const;
  readonly compoundName: string;
  constructor(name: string) {
    super(tr("diagnostic.resource_compound_not_found", { name }));
    this.name = "ResourceCompoundNotFoundError";
    this.compoundName = name;
  }
}

export async function readCompound(
  session: Session,
  name: string,
): Promise<{ uri: string; mimeType: string; text: string }> {
  const compound = await session.getCompound(name);
  if (!compound) {
    throw new ResourceCompoundNotFoundError(name);
  }
  return {
    uri: compoundUri(name),
    mimeType: "application/json",
    text: JSON.stringify(compound, null, 2),
  };
}
