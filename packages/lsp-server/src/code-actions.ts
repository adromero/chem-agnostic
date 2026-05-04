// ---------------------------------------------------------------------------
// LSP code-action handler — net-new in wp-027 (NOT extracted from any prior
// implementation; wp-026 deliberately deferred all quick-fix work).
//
// Maps each remediation surfaced by `runCheckEdit` to one or more LSP
// `CodeAction`s. The `remediation.kind` discriminator is one of the five
// values defined in `packages/core/schemas/check-edit-result.schema.json`:
//
//   - use_interface           — quick-fix per interface candidate; rewrites
//                                the offending import to the interface
//                                module's public path.
//   - move_to_compound        — quick-fix per compound candidate; emits a
//                                workspace edit that relocates the file into
//                                the chosen compound's role folder.
//   - move_to_role_folder     — single-target move under the current compound
//                                into `expected_folder`.
//   - import_via_public_surface — rewrite the import to go through the
//                                target compound's public surface file.
//   - add_compound_import     — add a new top-level import from the target
//                                compound's public surface (useful when the
//                                source has none yet).
//
// The handler does NOT emit kinds that aren't in the schema; earlier draft
// names (`wrap_in_interface`, `import_from_public_surface`) do not exist —
// emitting them would silently produce no-op actions and break round-2
// schema fidelity.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import {
  CodeAction,
  CodeActionKind,
  Diagnostic as LspDiagnostic,
  OptionalVersionedTextDocumentIdentifier,
  Range,
  TextDocumentEdit,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver/node";
import type { CheckEditDiagnostic, DiagnosticRemediation } from "@chemag/core";
import { pathToUri } from "./diagnostics.js";
import type { WorkspaceState } from "./workspace-state.js";

export interface CodeActionContext {
  /** Per-client workspace state. */
  state: WorkspaceState;
  /** URI of the file the actions are being computed for. */
  uri: string;
  /** LSP Diagnostics that the client passed via `params.context.diagnostics`. */
  contextDiagnostics: LspDiagnostic[];
  /** Raw check-edit diagnostics for the same file. */
  rawDiagnostics: CheckEditDiagnostic[];
}

/**
 * Build LSP code actions for every diagnostic that carries a remediation.
 * Returns an empty array when there are no actionable diagnostics.
 */
export function buildCodeActions(ctx: CodeActionContext): CodeAction[] {
  const out: CodeAction[] = [];

  for (const rawDiag of ctx.rawDiagnostics) {
    if (!rawDiag.remediation) continue;
    const matchingLsp = matchLspDiagnostic(ctx.contextDiagnostics, rawDiag);
    out.push(...buildActionsForRemediation(ctx, rawDiag, matchingLsp));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Per-kind handlers
// ---------------------------------------------------------------------------

function buildActionsForRemediation(
  ctx: CodeActionContext,
  rawDiag: CheckEditDiagnostic,
  matchingLsp: LspDiagnostic | null,
): CodeAction[] {
  const remediation = rawDiag.remediation as DiagnosticRemediation;
  switch (remediation.kind) {
    case "use_interface":
      return buildUseInterfaceActions(ctx, rawDiag, remediation, matchingLsp);
    case "move_to_compound":
      return buildMoveToCompoundActions(ctx, rawDiag, remediation, matchingLsp);
    case "move_to_role_folder":
      return buildMoveToRoleFolderActions(ctx, rawDiag, remediation, matchingLsp);
    case "import_via_public_surface":
      return buildImportViaPublicSurfaceActions(ctx, rawDiag, remediation, matchingLsp);
    case "add_compound_import":
      return buildAddCompoundImportActions(ctx, rawDiag, remediation, matchingLsp);
    default: {
      // Exhaustiveness check — TypeScript will flag this if a new schema kind
      // is added without updating the switch.
      const _exhaustive: never = remediation;
      void _exhaustive;
      return [];
    }
  }
}

function buildUseInterfaceActions(
  ctx: CodeActionContext,
  rawDiag: CheckEditDiagnostic,
  remediation: Extract<DiagnosticRemediation, { kind: "use_interface" }>,
  matchingLsp: LspDiagnostic | null,
): CodeAction[] {
  // We don't have enough information to mechanically rewrite the import path
  // (we'd need the interface compound + module path resolution). Surface each
  // candidate as an actionable suggestion that, when selected, replaces the
  // imported_module text with `<candidate>` so the user can finish wiring it.
  const offendingModule = rawDiag.imported_module;
  return remediation.interface_candidates.map((candidate) => {
    const action: CodeAction = {
      title: `Use interface "${candidate}" instead`,
      kind: CodeActionKind.QuickFix,
      diagnostics: matchingLsp ? [matchingLsp] : undefined,
      ...(offendingModule
        ? {
            edit: replaceImportSpecifierEdit(ctx.uri, rawDiag, offendingModule, candidate),
          }
        : {}),
    };
    return action;
  });
}

function buildMoveToCompoundActions(
  ctx: CodeActionContext,
  rawDiag: CheckEditDiagnostic,
  remediation: Extract<DiagnosticRemediation, { kind: "move_to_compound" }>,
  matchingLsp: LspDiagnostic | null,
): CodeAction[] {
  const ws = ctx.state.loadWorkspace();
  if (!ws) {
    // Without a workspace we can still surface the choices as title-only
    // actions; the user can move the file manually.
    return remediation.compound_candidates.map((compound) => ({
      title: `Move file to compound "${compound}"`,
      kind: CodeActionKind.QuickFix,
      diagnostics: matchingLsp ? [matchingLsp] : undefined,
    }));
  }

  // The check-edit engine surfaces this remediation when the file's role is
  // known but its containing compound is wrong. The role-folder name comes
  // from the workspace's roles map keyed by the file's current role; we can
  // infer it by reusing the same `role-folder` lookup the engine used.
  const fileRole = inferRoleFromUri(ctx.uri, ws);
  const roleFolder = fileRole ? ws.roles[fileRole]?.folder : undefined;
  const compoundsRoot = path.resolve(ctx.state.workspaceDir, ws.paths.compounds);
  const oldPath = path.resolve(uriToFsPath(ctx.uri));

  return remediation.compound_candidates.map((compound) => {
    const newDir = roleFolder
      ? path.join(compoundsRoot, compound, roleFolder)
      : path.join(compoundsRoot, compound);
    const newPath = path.join(newDir, path.basename(oldPath));

    const edit: WorkspaceEdit = {
      documentChanges: [
        {
          kind: "rename",
          oldUri: pathToUri(oldPath),
          newUri: pathToUri(newPath),
          options: { overwrite: false, ignoreIfExists: false },
        },
      ],
    };

    return {
      title: `Move file to compound "${compound}"`,
      kind: CodeActionKind.QuickFix,
      diagnostics: matchingLsp ? [matchingLsp] : undefined,
      edit,
    } satisfies CodeAction;
  });
}

function buildMoveToRoleFolderActions(
  ctx: CodeActionContext,
  rawDiag: CheckEditDiagnostic,
  remediation: Extract<DiagnosticRemediation, { kind: "move_to_role_folder" }>,
  matchingLsp: LspDiagnostic | null,
): CodeAction[] {
  const ws = ctx.state.loadWorkspace();
  const oldPath = uriToFsPath(ctx.uri);

  // Compute the destination: keep the file under the same compound, but put
  // it inside `expected_folder`.
  let newPath: string | null = null;
  if (ws) {
    const compoundsRoot = path.resolve(ctx.state.workspaceDir, ws.paths.compounds);
    // Walk up until we find the compound directory (a direct child of
    // compoundsRoot that is an ancestor of oldPath).
    const rel = path.relative(compoundsRoot, oldPath);
    if (!rel.startsWith("..")) {
      const segments = rel.split(path.sep);
      if (segments.length >= 2) {
        const compoundName = segments[0];
        newPath = path.join(
          compoundsRoot,
          compoundName,
          remediation.expected_folder,
          path.basename(oldPath),
        );
      }
    }
  }

  const action: CodeAction = {
    title: `Move file to role folder "${remediation.expected_folder}"`,
    kind: CodeActionKind.QuickFix,
    diagnostics: matchingLsp ? [matchingLsp] : undefined,
    ...(newPath
      ? {
          edit: {
            documentChanges: [
              {
                kind: "rename",
                oldUri: ctx.uri,
                newUri: pathToUri(newPath),
                options: { overwrite: false, ignoreIfExists: false },
              },
            ],
          } satisfies WorkspaceEdit,
        }
      : {}),
  };
  return [action];
}

function buildImportViaPublicSurfaceActions(
  ctx: CodeActionContext,
  rawDiag: CheckEditDiagnostic,
  remediation: Extract<DiagnosticRemediation, { kind: "import_via_public_surface" }>,
  matchingLsp: LspDiagnostic | null,
): CodeAction[] {
  const offendingModule = rawDiag.imported_module;
  // Rewrite the offending specifier to point at the public surface.
  const surfaceModule = `${remediation.target_compound}/${remediation.surface}`;
  const action: CodeAction = {
    title: `Import via public surface "${surfaceModule}"`,
    kind: CodeActionKind.QuickFix,
    diagnostics: matchingLsp ? [matchingLsp] : undefined,
    ...(offendingModule
      ? {
          edit: replaceImportSpecifierEdit(ctx.uri, rawDiag, offendingModule, surfaceModule),
        }
      : {}),
  };
  return [action];
}

function buildAddCompoundImportActions(
  ctx: CodeActionContext,
  _rawDiag: CheckEditDiagnostic,
  remediation: Extract<DiagnosticRemediation, { kind: "add_compound_import" }>,
  matchingLsp: LspDiagnostic | null,
): CodeAction[] {
  // We can't blindly add a top-level import without knowing the surface
  // module name and the source language's import syntax. Surface a
  // human-actionable title and (when enough context is known) a comment
  // marker the user can complete; otherwise emit a title-only QuickFix that
  // documents the required edit.
  const ws = ctx.state.loadWorkspace();
  const surface = ws?.rules?.public_surface ?? "index";
  const surfaceModule = `${remediation.target_compound}/${surface}`;

  // Insert at the top of the file: line 0, column 0. We emit a comment line
  // describing the required import; an IDE-side rewrite (or future LSP-level
  // language-aware edit) can replace this with a real `import` statement.
  const insertion = `// chemag: add a top-level import from "${surfaceModule}"\n`;
  const edit: WorkspaceEdit = {
    documentChanges: [
      TextDocumentEdit.create(OptionalVersionedTextDocumentIdentifier.create(ctx.uri, null), [
        TextEdit.insert({ line: 0, character: 0 }, insertion),
      ]),
    ],
  };
  return [
    {
      title: `Add compound import: ${remediation.target_compound}`,
      kind: CodeActionKind.QuickFix,
      diagnostics: matchingLsp ? [matchingLsp] : undefined,
      edit,
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the LSP `Diagnostic` that the client supplied as context that matches
 * this raw diagnostic. We pair on (code, line) which is unique per file.
 */
function matchLspDiagnostic(
  candidates: LspDiagnostic[],
  raw: CheckEditDiagnostic,
): LspDiagnostic | null {
  if (candidates.length === 0) return null;
  const rawCode = raw.code;
  const rawLine = (raw.line ?? 1) - 1;
  return (
    candidates.find((c) => c.code === rawCode && c.range.start.line === rawLine) ??
    candidates.find((c) => c.code === rawCode) ??
    null
  );
}

/**
 * Build a TextEdit-based WorkspaceEdit that replaces the FIRST occurrence of
 * `oldSpecifier` on the diagnostic's reported line with `newSpecifier`.
 *
 * This is a heuristic: a real fix would need a language-aware rewrite, but
 * for v0.2 we only emit the edit when we can find the exact substring on
 * the reported line. Returns an undefined `edit` (the surrounding caller
 * spreads it conditionally) when the replacement target can't be located.
 */
function replaceImportSpecifierEdit(
  uri: string,
  rawDiag: CheckEditDiagnostic,
  oldSpecifier: string,
  newSpecifier: string,
): WorkspaceEdit | undefined {
  const filePath = uriToFsPath(uri);
  let line: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs") as typeof import("node:fs");
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const lineIndex = (rawDiag.line ?? 1) - 1;
    if (lineIndex < 0 || lineIndex >= lines.length) return undefined;
    line = lines[lineIndex];
  } catch {
    return undefined;
  }

  const idx = line.indexOf(oldSpecifier);
  if (idx < 0) return undefined;

  const range = Range.create(
    (rawDiag.line ?? 1) - 1,
    idx,
    (rawDiag.line ?? 1) - 1,
    idx + oldSpecifier.length,
  );

  return {
    documentChanges: [
      TextDocumentEdit.create(OptionalVersionedTextDocumentIdentifier.create(uri, null), [
        TextEdit.replace(range, newSpecifier),
      ]),
    ],
  };
}

function uriToFsPath(uri: string): string {
  // Local copy to avoid a circular import with diagnostics.ts.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const url = require("node:url") as typeof import("node:url");
  return url.fileURLToPath(uri);
}

function inferRoleFromUri(
  uri: string,
  workspace: ReturnType<WorkspaceState["loadWorkspace"]>,
): string | null {
  if (!workspace) return null;
  const filePath = uriToFsPath(uri);
  // Find a folder name in the path that matches one of the workspace's role
  // folder definitions.
  const segments = filePath.split(path.sep);
  const folderToRole = new Map<string, string>();
  for (const [role, def] of Object.entries(workspace.roles)) {
    folderToRole.set(def.folder, role);
  }
  for (const seg of segments) {
    const role = folderToRole.get(seg);
    if (role) return role;
  }
  return null;
}
