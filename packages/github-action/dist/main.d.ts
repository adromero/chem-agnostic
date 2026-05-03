import { type CommentMode } from "./comment";
import { type RenderableDiagnostic } from "./format-comment";
export type FailOn = "error" | "warning" | "never";
export type ChemCommand = "check" | "analyze" | "both";
export type FormatName = "human" | "json" | "sarif" | "junit";
export interface Inputs {
    workspace: string;
    command: ChemCommand;
    failOn: FailOn;
    format: FormatName;
    commentMode: CommentMode;
    changedOnly: boolean;
    vocabulary: "standard" | "chemistry";
    /**
     * GitHub token. Empty string ⇒ no token configured; we fall back to
     * `process.env.GITHUB_TOKEN`. If both are empty, comment posting and
     * `pulls.listFiles` are skipped (and the user is warned once).
     */
    githubToken: string;
}
export type InputReader = (name: string) => string;
export declare function parseInputs(read: InputReader): Inputs;
export declare function diagnosticsFromSarif(sarifText: string): RenderableDiagnostic[];
/**
 * Merge two SARIF JSON strings into a single log (concatenating the `results`
 * arrays of each run). Used when the user picks `command: both` so we emit a
 * single SARIF file containing diagnostics from both check and analyze.
 */
export declare function mergeSarif(a: string, b: string): string;
/**
 * Locate the `chemag` binary on PATH. Returns the resolved path on success.
 * On failure, attempts a global install with `npm install -g @chemag/cli`
 * and returns the post-install path. Throws with a clear message if neither
 * step works.
 */
export declare function locateChemagCli(): Promise<string>;
interface RunChemagOptions {
    cliPath: string;
    command: "check" | "analyze";
    workspaceFile: string;
    vocabulary: string;
    /** When provided and non-empty, passed as repeated `--changed <file>` flags. */
    changedFiles?: string[];
    cwd: string;
}
/**
 * Run `chemag <command> --format sarif <workspace>` and return the captured
 * stdout. Non-zero exit codes are EXPECTED (1 on violations) — we only
 * throw when the CLI fails to invoke or exits with code >= 2 (usage/IO
 * error).
 */
export declare function runChemag(opts: RunChemagOptions): Promise<string>;
export declare function meetsThreshold(diagnostics: RenderableDiagnostic[], failOn: FailOn): boolean;
export declare function run(): Promise<void>;
export {};
