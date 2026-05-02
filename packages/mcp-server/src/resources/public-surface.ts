// ---------------------------------------------------------------------------
// `architecture://compound/{name}/public-surface` — list the exported names
// declared on a compound's public surface, derived from the manifest's
// `exports` map. Returns plain text (one symbol per line). Cross-compound
// imports must go through these symbols only when the workspace declares
// `rules.cross_compound_imports: public_only`.
//
// Errors:
//   * unknown compound → CHEM-MCP-302 (resource_compound_not_found)
// ---------------------------------------------------------------------------

import type { Session } from "../context.js";
import { ResourceCompoundNotFoundError } from "./compound.js";

export const PUBLIC_SURFACE_URI_TEMPLATE = "architecture://compound/{name}/public-surface";

export function publicSurfaceUri(name: string): string {
  return `architecture://compound/${name}/public-surface`;
}

export async function readPublicSurface(
  session: Session,
  name: string,
): Promise<{ uri: string; mimeType: string; text: string }> {
  const compound = await session.getCompound(name);
  if (!compound) {
    throw new ResourceCompoundNotFoundError(name);
  }

  const lines: string[] = [];
  // The manifest's `exports` map is `{ <role>: [<unitName>, ...] }`. We list
  // role-grouped symbols so the consumer can see what each export is. The
  // public surface FILE itself (e.g. `public.ts`) is one level removed; that
  // path is stored on the workspace, not here, but we surface it as a header
  // so callers can correlate.
  if (compound.exports !== undefined) {
    for (const [role, names] of Object.entries(compound.exports)) {
      for (const exportName of names ?? []) {
        lines.push(`${role}: ${exportName}`);
      }
    }
  }

  const body = lines.length === 0 ? "(no exports declared)\n" : `${lines.join("\n")}\n`;
  return {
    uri: publicSurfaceUri(name),
    mimeType: "text/plain",
    text: body,
  };
}
