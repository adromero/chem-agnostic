// ---------------------------------------------------------------------------
// Per-tool default paths and budgets. Lives in its own module so per-emitter
// files can import it without pulling in the full dispatcher (which would
// create a circular import).
// ---------------------------------------------------------------------------

export type EmitterTool = "claude" | "agents" | "cursor" | "copilot" | "aider" | "cline";

/**
 * Default relative paths each emitter writes to. The CLI joins these against
 * `--out-dir` (defaults to the workspace root).
 */
export const DEFAULT_PATHS: Record<EmitterTool, string> = {
  claude: "CLAUDE.md",
  agents: "AGENTS.md",
  cursor: ".cursor/rules/architecture.mdc",
  copilot: ".github/copilot-instructions.md",
  aider: ".aider/CONVENTIONS.md",
  cline: ".clinerules",
};

/**
 * Default per-tool line budgets. Cursor and Copilot have tighter budgets per
 * the ETH study cited in the master plan.
 */
export const DEFAULT_BUDGETS: Record<EmitterTool, number> = {
  claude: 80,
  agents: 80,
  cursor: 60,
  copilot: 40,
  aider: 80,
  cline: 80,
};
