// ---------------------------------------------------------------------------
// Markdown rendering for the PR comment body. Pure: takes a list of
// diagnostics + workspace metadata, returns the comment body string. The
// sticky-comment marker is appended by `comment.ts`, not here, so the
// renderer can be unit-tested without coupling to the marker constant.
// ---------------------------------------------------------------------------

export interface RenderableDiagnostic {
  level: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  line?: number;
  compound?: string;
}

export interface FormatCommentOptions {
  workspace: string;
  command: "check" | "analyze" | "both";
  diagnostics: RenderableDiagnostic[];
  /**
   * When provided, file names in the table become Markdown links pointing
   * at the PR's view of the file (`<repoUrl>/blob/<sha>/<file>#L<line>`).
   * When undefined, file names render as plain text.
   */
  blobBase?: string;
  /** Total file count in the diff (for the summary line). */
  changedFileCount?: number;
  /** chemag CLI version (rendered in the footer). */
  toolVersion?: string;
}

/**
 * Render the full PR comment body. Always returns a non-empty string. When
 * there are zero diagnostics, the body congratulates the user and shows a
 * "Run locally" hint anyway — useful for confirming the action ran.
 */
export function renderCommentBody(opts: FormatCommentOptions): string {
  const { workspace, command, diagnostics } = opts;
  const errors = diagnostics.filter((d) => d.level === "error").length;
  const warnings = diagnostics.filter((d) => d.level === "warning").length;

  const lines: string[] = [];
  lines.push(`### chemag — \`${workspace}\``);
  lines.push("");

  if (diagnostics.length === 0) {
    lines.push(`No architectural violations detected by \`chemag ${command}\`.`);
  } else {
    lines.push(
      `\`chemag ${command}\` found **${errors}** error${errors === 1 ? "" : "s"} and **${warnings}** warning${warnings === 1 ? "" : "s"}.`,
    );
    if (typeof opts.changedFileCount === "number") {
      lines.push(
        `Scanned **${opts.changedFileCount}** changed file${opts.changedFileCount === 1 ? "" : "s"}.`,
      );
    }
    lines.push("");
    lines.push(renderDiagnosticTable(diagnostics, opts.blobBase));
  }

  lines.push("");
  lines.push("<details><summary>Run locally</summary>");
  lines.push("");
  lines.push("```bash");
  lines.push(`pnpm dlx @chemag/cli ${command === "both" ? "check" : command} ${workspace}`);
  lines.push("```");
  lines.push("");
  lines.push("</details>");

  if (opts.toolVersion) {
    lines.push("");
    lines.push(`<sub>chemag v${opts.toolVersion}</sub>`);
  }

  return `${lines.join("\n")}\n`;
}

function renderDiagnosticTable(
  diagnostics: RenderableDiagnostic[],
  blobBase: string | undefined,
): string {
  const rows: string[] = [];
  rows.push("| Level | Code | Location | Message |");
  rows.push("| --- | --- | --- | --- |");
  // Cap rows so the comment doesn't exceed GitHub's 65k-char limit on huge
  // workspaces. The full set is in the SARIF; the table is a summary.
  const MAX_ROWS = 50;
  for (const d of diagnostics.slice(0, MAX_ROWS)) {
    rows.push(
      `| ${escapeCell(levelEmoji(d.level))} | \`${escapeCell(d.code)}\` | ${renderLocation(d, blobBase)} | ${escapeCell(d.message)} |`,
    );
  }
  if (diagnostics.length > MAX_ROWS) {
    rows.push(
      `| ... | | | _${diagnostics.length - MAX_ROWS} more diagnostic${diagnostics.length - MAX_ROWS === 1 ? "" : "s"} omitted; see SARIF for full list._ |`,
    );
  }
  return rows.join("\n");
}

function levelEmoji(level: "error" | "warning"): string {
  return level === "error" ? "error" : "warn";
}

function renderLocation(d: RenderableDiagnostic, blobBase: string | undefined): string {
  if (!d.file) {
    return d.compound ? `_compound: ${escapeCell(d.compound)}_` : "_workspace_";
  }
  const display = d.line ? `${d.file}:${d.line}` : d.file;
  if (blobBase) {
    const safeBase = blobBase.replace(/\/+$/, "");
    const anchor = d.line ? `#L${d.line}` : "";
    return `[${escapeCell(display)}](${safeBase}/${encodePath(d.file)}${anchor})`;
  }
  return escapeCell(display);
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

/**
 * Escape Markdown table-breaking characters: backticks, pipes, and newlines.
 * GitHub's GFM table parser is unforgiving about embedded `|`.
 */
function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}
