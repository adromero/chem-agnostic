// ---------------------------------------------------------------------------
// Shared types for the rules-emitter family. Lives in its own module so the
// per-emitter files can import the shape without pulling in the dispatcher.
// ---------------------------------------------------------------------------

import type { Diagnostic } from "../types.js";

/**
 * Structured intermediate consumed by every emitter. Emitter-agnostic: no
 * tool-specific markup or wrappers. Per-emitter renderers shape these into
 * their final form.
 */
export interface RulesContent {
  /** Workspace name — drives the H1 heading on AGENTS/CLAUDE files. */
  workspaceName: string;
  /** One-paragraph intro pointing the agent at workspace.yaml. */
  intro: string;
  /** Brief architecture summary (roles, what each is for). */
  architectureSummary: string;
  /** Pre-rendered dependency-rule markdown table. */
  dependencyRulesTable: string;
  /** Cross-module-import rule (one-liner the agent must obey). */
  crossModuleRule: string;
  /** Pointer to `chemag check` / `chemag analyze` for validation. */
  toolingPointer: string;
  /** Bulleted "where to look" list (workspace.yaml, compound.yaml, ...). */
  whereToLook: string[];
  /**
   * Optional violations block, populated when the CLI is invoked with
   * `--include-violations`. Each entry is a diagnostic captured today.
   */
  violations?: Diagnostic[];
}

export interface EmitOptions {
  /** Tightest line budget the emitter may produce, in lines. */
  maxLines?: number;
}

export interface EmittedFile {
  /** Repo-relative path the file should be written to. */
  path: string;
  /**
   * The chemag-managed block, wrapped in `<!-- chemag:rules:start -->` /
   * `<!-- chemag:rules:end -->` markers. NO trailing newline. This is what
   * `mergeBetweenMarkers` splices into existing files.
   */
  block: string;
  /**
   * Optional content rendered AFTER the chemag block. For Claude this is
   * the plugin-contributed language section; for emitters with violations
   * this is the violations block. Empty string when nothing extra is
   * rendered. NO leading or trailing newlines.
   */
  trailing: string;
  /**
   * Optional content rendered BEFORE the chemag block. Used by the Cursor
   * MDC emitter to put YAML frontmatter at the top of the file.
   */
  leading: string;
  /** Final body string (already wrapped in chemag:rules markers, with a single trailing newline). */
  body: string;
  /** Warnings produced during rendering (e.g. budget exceeded). */
  warnings: string[];
}
