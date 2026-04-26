// ---------------------------------------------------------------------------
// Content hashing for cache keys.
//
// We compute a sha256 over the source bytes and return the first 24 characters
// of a base64url-encoded digest. That gives us a short, filesystem-safe token
// (no slashes, no padding) with ample entropy for cache-key collision
// avoidance against any realistic project size.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

/**
 * Hash arbitrary content (string or bytes) and return the first 24 characters
 * of its base64url sha256 digest.
 */
export function contentHash(content: string | Buffer): string {
  const h = createHash("sha256");
  h.update(content);
  // Node's "base64url" encoding produces an unpadded URL-safe base64 string.
  return h.digest("base64url").slice(0, 24);
}
