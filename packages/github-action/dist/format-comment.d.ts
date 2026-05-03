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
export declare function renderCommentBody(opts: FormatCommentOptions): string;
