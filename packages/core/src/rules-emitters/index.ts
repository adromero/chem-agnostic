// ---------------------------------------------------------------------------
// Rules-emitter dispatcher + shared content builder.
//
// `chemag emit-rules` produces compact, AI-editor-friendly rule files from a
// workspace. Each tool (Claude / AGENTS / Cursor / Copilot / Aider / Cline)
// gets its own emitter file in this directory; the dispatcher below picks
// the right one and builds the per-tool target path.
//
// `buildRulesContent` is the language-agnostic content shape: every emitter
// consumes the same structured intermediate so the snapshot tests can verify
// that the shared sections do not drift between AGENTS.md and CLAUDE.md.
// ---------------------------------------------------------------------------

import type { Diagnostic, LoadedCompound, Workspace } from "../types.js";
import { tr } from "../vocabulary/index.js";
import { emitAgentsMd } from "./agents-md.js";
import { emitClaudeMd } from "./claude-md.js";
import { emitCursorMdc } from "./cursor-mdc.js";
import { emitCopilotInstructions } from "./copilot-instructions.js";
import { emitAiderConventions } from "./aider-conventions.js";
import { emitClineRules } from "./cline-rules.js";
import { DEFAULT_BUDGETS, DEFAULT_PATHS, type EmitterTool } from "./paths.js";
import type { EmittedFile, EmitOptions, RulesContent } from "./types.js";

export type { EmitterTool } from "./paths.js";
export type { RulesContent, EmitOptions, EmittedFile } from "./types.js";
export { DEFAULT_BUDGETS, DEFAULT_PATHS } from "./paths.js";

export const SUPPORTED_TOOLS: readonly EmitterTool[] = [
  "claude",
  "agents",
  "cursor",
  "copilot",
  "aider",
  "cline",
] as const;

export interface BuildRulesOptions {
  /** Optional list of current diagnostics to embed under `--include-violations`. */
  violations?: Diagnostic[];
}

/**
 * Build the language-agnostic content shape from a workspace + compound list.
 * Reads `tr()` synchronously, so callers must apply the workspace vocabulary
 * (Phase 2) before invoking.
 */
export function buildRulesContent(
  workspace: Workspace,
  compounds: LoadedCompound[],
  options: BuildRulesOptions = {},
): RulesContent {
  const intro = buildIntro(workspace);
  const architectureSummary = buildArchitectureSummary(workspace);
  const dependencyRulesTable = buildDependencyTable(workspace);
  const crossModuleRule = buildCrossModuleRule(workspace);
  const toolingPointer = buildToolingPointer();
  const whereToLook = buildWhereToLook(workspace, compounds);

  return {
    workspaceName: workspace.workspace,
    intro,
    architectureSummary,
    dependencyRulesTable,
    crossModuleRule,
    toolingPointer,
    whereToLook,
    violations: options.violations,
  };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildIntro(workspace: Workspace): string {
  // Pull the first non-heading prose line from claude_md.intro and trim to
  // a single sentence. Vocabulary controls phrasing.
  const raw = tr("claude_md.intro", { name: workspace.workspace });
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return raw;
}

function buildArchitectureSummary(workspace: Workspace): string {
  const lines: string[] = [];
  lines.push(`This workspace uses a ${tr("concept.bond")}-driven architecture.`);
  const roleCount = Object.keys(workspace.roles).length;
  lines.push(
    `Each ${tr("concept.unit")} has a role; there are ${roleCount} roles in this workspace.`,
  );
  return lines.join(" ");
}

function buildDependencyTable(workspace: Workspace): string {
  const lines: string[] = [];
  lines.push("| Role | Can depend on |");
  lines.push("|------|---------------|");
  for (const [role, allowed] of Object.entries(workspace.bonds)) {
    const allowedCol = allowed.length === 0 ? "(none)" : allowed.join(", ");
    lines.push(`| ${role} | ${allowedCol} |`);
  }
  return lines.join("\n");
}

function buildCrossModuleRule(workspace: Workspace): string {
  const surface = workspace.rules?.public_surface;
  if (workspace.rules?.cross_compound_imports === "public_only") {
    if (surface) {
      return (
        `Cross-${tr("container.compound")} imports go through the public surface ` +
        `(\`${surface}\`) only — never reach into internal files.`
      );
    }
    return `Cross-${tr("container.compound")} imports go through the public surface only — never reach into internal files.`;
  }
  return `Cross-${tr("container.compound")} imports must respect the dependency rules above.`;
}

function buildToolingPointer(): string {
  return [
    "Validate after edits:",
    "- `chemag check workspace.yaml` — manifest + filesystem checks",
    "- `chemag analyze workspace.yaml` — real imports vs dependency rules",
    "- `chemag check-edit <file>` — single-file edit validation (best for AI tools)",
  ].join("\n");
}

function buildWhereToLook(workspace: Workspace, compounds: LoadedCompound[]): string[] {
  const out: string[] = [];
  out.push("`workspace.yaml` — global roles, dependency rules, and module-type rules");
  const manifest = workspace.rules?.manifest_filename ?? "compound.yaml";
  out.push(`each module's \`${manifest}\` — declared units, exports, and imports`);
  if (compounds.length > 0) {
    const sample = compounds
      .slice(0, 3)
      .map((c) => `\`${c.manifest.compound}\``)
      .join(", ");
    const more = compounds.length > 3 ? `, +${compounds.length - 3} more` : "";
    out.push(`existing modules: ${sample}${more}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Render content for a single tool. The returned object is plain
 * `{ path, body, warnings }`; the CLI is responsible for IO.
 */
export function emitRules(
  content: RulesContent,
  tool: EmitterTool,
  options: EmitOptions = {},
): EmittedFile {
  const budget = options.maxLines ?? DEFAULT_BUDGETS[tool];
  switch (tool) {
    case "claude":
      return emitClaudeMd(content, { maxLines: budget });
    case "agents":
      return emitAgentsMd(content, { maxLines: budget });
    case "cursor":
      return emitCursorMdc(content, { maxLines: budget });
    case "copilot":
      return emitCopilotInstructions(content, { maxLines: budget });
    case "aider":
      return emitAiderConventions(content, { maxLines: budget });
    case "cline":
      return emitClineRules(content, { maxLines: budget });
  }
}

/**
 * Render every supported emitter. Returns a Map keyed by tool so callers can
 * look up specific emissions without re-dispatching.
 */
export function emitRulesAll(
  content: RulesContent,
  options: EmitOptions = {},
): Map<EmitterTool, EmittedFile> {
  const out = new Map<EmitterTool, EmittedFile>();
  for (const tool of SUPPORTED_TOOLS) {
    out.set(tool, emitRules(content, tool, options));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Re-exports — call sites can import from "@chemag/core/rules-emitters" only.
// ---------------------------------------------------------------------------

export { emitAgentsMd } from "./agents-md.js";
export { emitClaudeMd, CORE_HEADINGS, extractLanguageSection } from "./claude-md.js";
export { emitCursorMdc } from "./cursor-mdc.js";
export { emitCopilotInstructions } from "./copilot-instructions.js";
export { emitAiderConventions } from "./aider-conventions.js";
export { emitClineRules } from "./cline-rules.js";
export { renderSharedBody, renderViolations } from "./shared-body.js";
export {
  MARKER_START,
  MARKER_END,
  MarkersMissingError,
  mergeBetweenMarkers,
  wrapWithMarkers,
} from "./markers.js";
export type { MergeOptions, MergeResult } from "./markers.js";
