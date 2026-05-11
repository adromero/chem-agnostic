// ---------------------------------------------------------------------------
// LSP diagnostics — wraps @chemag/core's check-edit engine and converts the
// resulting `CheckEditDiagnostic[]` into LSP `Diagnostic[]`.
//
// The engine returns workspace-wide diagnostics for one file at a time; we
// publish them via `connection.sendDiagnostics(...)` keyed on the file URI
// the server was asked to check.
//
// Plugin resolution: we delegate to a small in-house resolver that looks at
// `workspace.language` and tries to require the corresponding plugin package.
// When no plugin is installed (or `workspace.language` is unset) we publish
// an empty diagnostics list for that file rather than crashing the server.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as url from "node:url";
import { runCheckEdit, type CheckEditDiagnostic, type LanguagePlugin } from "@chemag/core";
import { Diagnostic as LspDiagnostic, DiagnosticSeverity, Range } from "vscode-languageserver/node";
import type { WorkspaceState } from "./workspace-state.js";

// ---------------------------------------------------------------------------
// Plugin resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the language plugin for the active workspace. We require the plugin
 * package by name — at runtime the server is bundled and the plugin is
 * inlined, so a require() just hits the bundle's internal module map.
 *
 * Returns null when the language is unset or the plugin cannot be loaded.
 */
function resolveLanguagePlugin(state: WorkspaceState): LanguagePlugin | null {
  const ws = state.loadWorkspace();
  if (!ws) return null;
  const lang = ws.language;
  if (!lang) return null;

  // Map workspace.language → (plugin package name, named export). The plugins
  // export their LanguagePlugin instance under a `<lang>Plugin` named export
  // (no default export — see plugin-typescript/src/index.ts et al.).
  const lookup =
    lang === "typescript"
      ? { pkg: "@chemag/plugin-typescript", named: "typescriptPlugin" }
      : lang === "python"
        ? { pkg: "@chemag/plugin-python", named: "pythonPlugin" }
        : lang === "go"
          ? { pkg: "@chemag/plugin-go", named: "goPlugin" }
          : null;
  if (!lookup) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(lookup.pkg) as Record<string, unknown>;
    const named = mod[lookup.named];
    if (named) return named as LanguagePlugin;
    // Defensive fallbacks: support a future `default` export.
    if (mod.default) return mod.default as LanguagePlugin;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// File-URI / file-path conversion
// ---------------------------------------------------------------------------

/** Convert a `file://` URI to an absolute filesystem path. */
export function uriToPath(uri: string): string {
  return url.fileURLToPath(uri);
}

/** Convert an absolute filesystem path to a `file://` URI. */
export function pathToUri(p: string): string {
  return url.pathToFileURL(p).toString();
}

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

function mapSeverity(level: "error" | "warning" | "suggestion"): DiagnosticSeverity {
  if (level === "error") return DiagnosticSeverity.Error;
  if (level === "warning") return DiagnosticSeverity.Warning;
  // "suggestion" → Hint (LSP's lowest-severity bucket; renders as a soft
  // dotted underline in VS Code). Intentionally chosen over Information,
  // which is too prominent for "suggestion, not a problem".
  return DiagnosticSeverity.Hint;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CheckEditOutcome {
  /** The raw core-level diagnostics, keyed by file URI in `byFile`. */
  raw: CheckEditDiagnostic[];
  /** LSP diagnostics grouped by file URI. */
  byFile: Map<string, LspDiagnostic[]>;
}

/**
 * Run check-edit for a single file URI. Returns an empty result when:
 *   - the workspace is unloaded / unparseable,
 *   - the language plugin can't be resolved,
 *   - the file doesn't exist on disk and no override content is supplied.
 */
export function runDiagnostics(
  state: WorkspaceState,
  fileUri: string,
  content?: string,
): CheckEditOutcome {
  const empty: CheckEditOutcome = { raw: [], byFile: new Map() };

  const filePath = uriToPath(fileUri);
  // If the file doesn't exist on disk and we don't have an in-memory buffer,
  // there's nothing to check.
  if (content === undefined && !fs.existsSync(filePath)) return empty;

  const workspace = state.loadWorkspace();
  if (!workspace) return empty;

  const plugin = resolveLanguagePlugin(state);
  if (!plugin) return empty;

  const compounds = state.listCompounds();

  let raw: CheckEditDiagnostic[];
  try {
    const result = runCheckEdit({
      workspace,
      workspaceDir: state.workspaceDir,
      compounds,
      plugin,
      filePath,
      content,
    });
    raw = result.diagnostics;
  } catch {
    return empty;
  }

  // Group by URI. The check-edit engine surfaces the offending file as the
  // primary file path; cross-file diagnostics are not produced for a single
  // run, so all rows attach to either `filePath` (when the diagnostic carries
  // a `file` field) or to `filePath` as the fallback.
  const byFile = new Map<string, LspDiagnostic[]>();
  for (const d of raw) {
    const targetPath = d.file ?? filePath;
    const targetUri = pathToUri(targetPath);

    const line = (d.line ?? 1) - 1;
    const col = (d.column ?? 1) - 1;
    const range = Range.create(line, col, line, col + 1);
    const message = d.hint ? `${d.message} (${d.hint})` : d.message;
    const lsp: LspDiagnostic = {
      severity: mapSeverity(d.level),
      range,
      message,
      source: "chemag",
      code: d.code,
    };

    const list = byFile.get(targetUri) ?? [];
    list.push(lsp);
    byFile.set(targetUri, list);
  }

  // Ensure the requested file URI is always present in the map (with an empty
  // list when no diagnostics fired). The caller relies on this to clear the
  // previously-published diagnostics for that file.
  if (!byFile.has(fileUri)) byFile.set(fileUri, []);

  return { raw, byFile };
}
