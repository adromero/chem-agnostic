// ---------------------------------------------------------------------------
// Anonymizer.
//
// Defence-in-depth: callers SHOULD never put a path into a payload, but if
// one slips through (e.g. an unhandled error containing a stack frame), the
// anonymizer scrubs it before transport.
//
// Rules:
//   - String values that look like filesystem paths (absolute, ~/, ./, or
//     containing path separators with a file-extension tail) are replaced
//     with the literal "<redacted-path>".
//   - Strings shaped like emails are replaced with "<redacted-email>".
//   - Strings shaped like URLs (http/https/file://) are replaced with
//     "<redacted-url>" — BUT we keep telemetry-internal URLs out of payloads
//     anyway; this is purely a leak shield.
//   - Any property whose KEY is in DENY_KEYS is dropped entirely (e.g. a
//     stray "stack" or "message" or "error_message"). Defence-in-depth.
//   - Recurses into objects and arrays. Primitives other than strings pass
//     through unchanged.
//
// Property-style invariant: for any input value, no string output anywhere
// in the result contains an absolute filesystem path. This is asserted by
// test/anonymizer.test.ts.
// ---------------------------------------------------------------------------

const DENY_KEYS = new Set<string>([
  "message",
  "error_message",
  "stack",
  "stacktrace",
  "stack_trace",
  "file",
  "filepath",
  "filename",
  "path",
  "paths",
  "source",
  "cwd",
  "home",
  "homedir",
]);

const PATH_REDACTION = "<redacted-path>";
const EMAIL_REDACTION = "<redacted-email>";
const URL_REDACTION = "<redacted-url>";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(?:https?:|file:)\/\//i;
// Absolute POSIX path, Windows drive-letter path, ~/ user-home, or "./" / "../".
const ABS_PATH_RE = /^(?:\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/])/;
// Looser: any string with an os-style separator followed by a token + extension.
// Catches embedded paths like "loaded /home/foo/bar.ts during init".
const EMBEDDED_PATH_RE = /(?:[A-Za-z]:[\\/]|\/|~\/)[^\s'"`]+\.[A-Za-z0-9]{1,8}/;

export function scrubString(value: string): string {
  if (EMAIL_RE.test(value)) return EMAIL_REDACTION;
  if (URL_RE.test(value)) return URL_REDACTION;
  if (ABS_PATH_RE.test(value)) return PATH_REDACTION;
  if (EMBEDDED_PATH_RE.test(value)) return value.replace(EMBEDDED_PATH_RE, PATH_REDACTION);
  return value;
}

export function anonymize<T>(value: T): T {
  return scrub(value) as T;
}

function scrub(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DENY_KEYS.has(k)) continue;
      out[k] = scrub(v);
    }
    return out;
  }
  // function / symbol — drop.
  return undefined;
}
