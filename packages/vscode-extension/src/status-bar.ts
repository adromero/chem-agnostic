// ---------------------------------------------------------------------------
// Status-bar manager — single left-aligned StatusBarItem showing the active
// editor's compound/role, or "chemag: outside workspace" when the file is
// not part of any compound. Uses @chemag/core/loader for resolution.
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import * as path from "node:path";
import { discoverCompounds, loadWorkspace } from "@chemag/core";
import type { LoadedCompound, Workspace } from "@chemag/core";

const OUTSIDE_LABEL = "chemag: outside workspace";

interface CompoundIndex {
  compounds: LoadedCompound[];
  workspaceDir: string;
}

export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subs: vscode.Disposable[] = [];
  private indexCache: CompoundIndex | null = null;
  private indexCacheKey: string | null = null;

  constructor(private readonly workspaceDir: string) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    this.item.text = OUTSIDE_LABEL;
    this.item.tooltip = "chemag — active editor's compound and role";
    this.item.show();

    this.subs.push(vscode.window.onDidChangeActiveTextEditor((editor) => this.refresh(editor)));

    // Initial paint for whatever editor is already active at activation time.
    this.refresh(vscode.window.activeTextEditor);
  }

  /** Re-render the status bar for the given editor. Public for tests. */
  refresh(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      this.item.text = OUTSIDE_LABEL;
      return;
    }
    const filePath = editor.document.uri.fsPath;
    const label = this.labelFor(filePath);
    this.item.text = label ?? OUTSIDE_LABEL;
  }

  /** Resolve `compound/role` for a file path, or null when outside any compound. */
  private labelFor(filePath: string): string | null {
    const index = this.loadIndex();
    if (!index) return null;

    // Find the compound whose dir is an ancestor of filePath. Pick the
    // longest match in case nested compounds exist (defensive — the loader
    // currently doesn't emit nested compounds but the behaviour is robust).
    let bestMatch: LoadedCompound | null = null;
    let bestLen = -1;
    for (const c of index.compounds) {
      const cdir = c.dir + path.sep;
      const target = filePath + path.sep;
      if (target.startsWith(cdir) && cdir.length > bestLen) {
        bestMatch = c;
        bestLen = cdir.length;
      }
    }
    if (!bestMatch) return null;

    // Role: if the manifest enumerates units, prefer the unit whose `file`
    // matches the active path; otherwise inspect the parent folder name to
    // recover the role-folder convention.
    const compoundName = bestMatch.manifest.compound;
    const role = this.resolveRole(bestMatch, filePath);
    return role ? `chemag: ${compoundName}/${role}` : `chemag: ${compoundName}`;
  }

  private resolveRole(compound: LoadedCompound, filePath: string): string | null {
    const units = compound.manifest.units ?? [];
    for (const unit of units) {
      const unitPath = path.resolve(compound.dir, unit.file);
      if (unitPath === filePath) return unit.role;
    }
    // Fall back to the parent folder name (e.g. "compound/reactions/foo.ts").
    const rel = path.relative(compound.dir, filePath);
    const parts = rel.split(path.sep).filter(Boolean);
    if (parts.length >= 2) return parts[0];
    return null;
  }

  /**
   * Load + cache the compound index. The cache key is the workspace.yaml
   * mtime; a stale workspace will be re-loaded on the next status-bar
   * refresh. Returns null if the workspace cannot be loaded (so we render
   * `outside workspace` rather than throwing).
   */
  private loadIndex(): CompoundIndex | null {
    const wsPath = path.join(this.workspaceDir, "workspace.yaml");
    let key: string;
    try {
      const fs = require("node:fs") as typeof import("node:fs");
      const stat = fs.statSync(wsPath);
      key = `${wsPath}:${stat.mtimeMs}`;
    } catch {
      return null;
    }
    if (this.indexCache && this.indexCacheKey === key) return this.indexCache;

    let ws: Workspace;
    try {
      ws = loadWorkspace(wsPath);
    } catch {
      return null;
    }
    let compounds: LoadedCompound[];
    try {
      compounds = discoverCompounds(ws, this.workspaceDir);
    } catch {
      return null;
    }
    this.indexCache = { compounds, workspaceDir: this.workspaceDir };
    this.indexCacheKey = key;
    return this.indexCache;
  }

  dispose(): void {
    this.item.dispose();
    for (const sub of this.subs) sub.dispose();
  }
}
