// ---------------------------------------------------------------------------
// Idempotent merge markers for rule-file emission.
//
// Every emitted rule file carries a chemag-managed block delimited by
//   <!-- chemag:rules:start -->
//   <!-- chemag:rules:end -->
// markers. Manual content the user adds outside those markers is preserved
// across re-runs.
//
// For .mdc files (Cursor) the markers go *inside* the body section, after
// the YAML frontmatter — the frontmatter is regenerated on every run.
// ---------------------------------------------------------------------------

export const MARKER_START = "<!-- chemag:rules:start -->";
export const MARKER_END = "<!-- chemag:rules:end -->";

/**
 * Thrown when the existing file lacks chemag markers and `--overwrite` was
 * not passed. The CLI translates this into a `CHEM-EMIT-RULES-001`
 * diagnostic.
 */
export class MarkersMissingError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(
      `Refusing to rewrite "${path}": chemag markers are missing. Pass --overwrite to replace the existing file.`,
    );
    this.name = "MarkersMissingError";
    this.path = path;
  }
}

export interface MergeOptions {
  /** Allow replacing an existing file even when chemag markers are absent. */
  overwrite: boolean;
  /**
   * For Cursor MDC files the markers live inside the body, below the YAML
   * frontmatter. The frontmatter (delimited by `---` lines at the start of
   * the file) is regenerated on every run.
   */
  isMdc: boolean;
  /**
   * Content rendered BEFORE the chemag block on first write (e.g. YAML
   * frontmatter for MDC files). Ignored when an existing file is being
   * merged in non-MDC mode — the user's own pre-block content wins.
   */
  leading?: string;
  /**
   * Content rendered AFTER the chemag block on first write (e.g. plugin
   * language section, violations). Ignored when an existing file is being
   * merged — the user's own post-block content wins.
   */
  trailing?: string;
}

export interface MergeResult {
  body: string;
  warnings: string[];
}

/**
 * Merge the chemag-managed block into existing file content, preserving
 * user-authored content outside the markers. Returns the merged file body
 * (with a single trailing newline) plus any warnings produced during the
 * merge.
 *
 * Contract:
 *   - `block` is the markers-wrapped chemag content with NO trailing
 *     newline. Per-emitter renderers produce this via `wrapWithMarkers`.
 *   - When `existing` is null we synthesize the file from
 *     `leading? + block + trailing?` and a single trailing newline.
 *   - When `existing` contains markers, we splice `block` into the gap and
 *     keep everything before MARKER_START / after MARKER_END verbatim.
 *   - When `existing` lacks markers and `overwrite` is true, we replace the
 *     file wholesale (logging one warning).
 *   - When `existing` lacks markers and `overwrite` is false we throw
 *     `MarkersMissingError`.
 */
export function mergeBetweenMarkers(
  existing: string | null,
  block: string,
  opts: MergeOptions,
): MergeResult {
  const warnings: string[] = [];
  const leading = opts.leading ?? "";
  const trailing = opts.trailing ?? "";

  if (existing === null) {
    const parts: string[] = [];
    if (leading !== "") parts.push(leading);
    parts.push(block);
    if (trailing !== "") parts.push(trailing);
    return { body: ensureTrailingNewline(parts.join("\n")), warnings };
  }

  if (opts.isMdc) {
    return mergeMdc(existing, block, leading, trailing, opts, warnings);
  }

  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END, startIdx >= 0 ? startIdx : 0);

  if (startIdx === -1 || endIdx === -1) {
    if (!opts.overwrite) {
      throw new MarkersMissingError("");
    }
    warnings.push(
      "Existing file lacked chemag markers; --overwrite supplied, replacing the entire file.",
    );
    const parts: string[] = [];
    if (leading !== "") parts.push(leading);
    parts.push(block);
    if (trailing !== "") parts.push(trailing);
    return { body: ensureTrailingNewline(parts.join("\n")), warnings };
  }

  const before = existing.slice(0, startIdx);
  const afterStart = endIdx + MARKER_END.length;
  const after = existing.slice(afterStart);

  // Splice the new block into the gap. Pre/post-block user content is kept
  // verbatim, so `leading`/`trailing` are NOT re-injected on update — that
  // would clobber whatever the user added outside the markers.
  const stitched = `${before}${block}${after}`;
  return { body: stitched, warnings };
}

function mergeMdc(
  existing: string,
  block: string,
  leading: string,
  trailing: string,
  opts: MergeOptions,
  warnings: string[],
): MergeResult {
  // Strip existing frontmatter (delimited by leading `---` ... `---`).
  const lines = existing.split("\n");
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        bodyStart = i + 1;
        break;
      }
    }
  }
  const existingBody = lines.slice(bodyStart).join("\n");

  // Parse new frontmatter from `leading`. Caller passes the regenerated
  // YAML frontmatter as `leading` for MDC files.
  const newFrontmatter = leading;

  const startIdx = existingBody.indexOf(MARKER_START);
  const endIdx = existingBody.indexOf(MARKER_END, startIdx >= 0 ? startIdx : 0);

  if (startIdx === -1 || endIdx === -1) {
    if (!opts.overwrite) {
      throw new MarkersMissingError("");
    }
    warnings.push(
      "Existing MDC file lacked chemag markers; --overwrite supplied, replacing the entire file.",
    );
    const parts: string[] = [newFrontmatter, block];
    if (trailing !== "") parts.push(trailing);
    return { body: ensureTrailingNewline(parts.join("\n")), warnings };
  }

  const before = existingBody.slice(0, startIdx);
  const afterStart = endIdx + MARKER_END.length;
  const after = existingBody.slice(afterStart);
  const stitchedBody = `${before}${block}${after}`;
  const merged =
    newFrontmatter === "" ? stitchedBody : `${newFrontmatter}\n${stitchedBody.replace(/^\n+/, "")}`;
  return { body: merged, warnings };
}

/**
 * Wrap a chemag-managed block with start/end markers. The block is
 * separated from the markers by a single newline on each side. NO trailing
 * newline is added — callers compose the full file body themselves.
 */
export function wrapWithMarkers(content: string): string {
  const trimmed = content.replace(/^\n+/, "").replace(/\n+$/, "");
  return `${MARKER_START}\n${trimmed}\n${MARKER_END}`;
}

function ensureTrailingNewline(s: string): string {
  if (s.endsWith("\n")) return s;
  return `${s}\n`;
}
