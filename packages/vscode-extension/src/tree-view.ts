// ---------------------------------------------------------------------------
// Architecture sidebar tree view (wp-026c).
//
// Renders the workspace as a three-level tree: compound -> role folder -> unit.
// Violation-count badges are shown on units (count of chemag-source diagnostics
// for the unit's file URI) and aggregated upward onto compound nodes.
//
// Refresh primitives:
//   1. `vscode.languages.onDidChangeDiagnostics` — recomputes badges. We fire
//      `_onDidChangeTreeData.fire(undefined)` for the v1 implementation; per-
//      node mapping is unnecessary at this scale and the spec explicitly
//      permits it.
//   2. `vscode.workspace.createFileSystemWatcher` over
//      `**/{workspace,compound}.yaml` — re-walks the workspace via
//      `loadWorkspace` + `discoverCompounds`. Debounced ~150 ms so a single
//      save isn't amplified into multiple reloads.
//
// Failure mode: any exception during workspace load is logged to the optional
// OutputChannel and the tree empties (returns []), so a malformed manifest
// does not crash the extension.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import * as vscode from "vscode";
import { discoverCompounds, loadWorkspace } from "@chemag/core";
import type { LoadedCompound, UnitDeclaration, Workspace } from "@chemag/core";

const VIEW_ID = "chemag.architecture";
const REFRESH_DEBOUNCE_MS = 150;

// ---------------------------------------------------------------------------
// Node model
// ---------------------------------------------------------------------------

export type TreeNode = CompoundNode | RoleNode | UnitNode | EmptyPlaceholderNode;

export interface CompoundNode {
  kind: "compound";
  name: string;
  dir: string;
}

export interface RoleNode {
  kind: "role";
  compound: string;
  role: string;
  compoundDir: string;
  units: UnitDeclaration[];
}

export interface UnitNode {
  kind: "unit";
  compound: string;
  compoundDir: string;
  unit: UnitDeclaration;
}

/**
 * Rendered as the only child of an `alpha`-shaped compound (one with no
 * declared units). Surfacing an explicit explanation is friendlier than an
 * empty expandable node, and the test asserts on this exact shape.
 */
export interface EmptyPlaceholderNode {
  kind: "empty";
  compound: string;
  compoundDir: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

class ChemagTreeDataProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined> =
    this._onDidChangeTreeData.event;

  private compounds: LoadedCompound[] = [];

  constructor(
    private readonly workspaceDir: string,
    private readonly output: vscode.OutputChannel | undefined,
  ) {
    this.reload();
  }

  /** Public so the owning ChemagTreeView can drive refreshes from watchers. */
  reload(): void {
    try {
      const wsPath = path.join(this.workspaceDir, "workspace.yaml");
      const ws: Workspace = loadWorkspace(wsPath);
      this.compounds = discoverCompounds(ws, this.workspaceDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.output?.appendLine(`[tree-view] reload failed: ${msg}`);
      this.compounds = [];
    }
  }

  fireChanged(node?: TreeNode): void {
    this._onDidChangeTreeData.fire(node);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.kind) {
      case "compound": {
        const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = "chemag.compound";
        item.iconPath = new vscode.ThemeIcon("package");
        const count = this.compoundDiagnosticCount(node);
        if (count > 0) item.description = `${count}`;
        item.tooltip = `compound ${node.name}${count > 0 ? ` (${count} violation${count === 1 ? "" : "s"})` : ""}`;
        return item;
      }
      case "role": {
        const item = new vscode.TreeItem(node.role, vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = "chemag.role";
        item.iconPath = new vscode.ThemeIcon("symbol-folder");
        item.tooltip = `role ${node.role}`;
        return item;
      }
      case "unit": {
        const item = new vscode.TreeItem(node.unit.name, vscode.TreeItemCollapsibleState.None);
        item.contextValue = "chemag.unit";
        item.iconPath = new vscode.ThemeIcon("symbol-method");
        const fileUri = vscode.Uri.file(this.unitAbsolutePath(node));
        item.resourceUri = fileUri;
        item.command = {
          command: "vscode.open",
          title: "Open unit",
          arguments: [fileUri],
        };
        const count = this.unitDiagnosticCount(node);
        if (count > 0) item.description = `${count}`;
        item.tooltip = `${node.compound}/${node.unit.role}/${node.unit.name}${count > 0 ? ` — ${count} violation${count === 1 ? "" : "s"}` : ""}`;
        return item;
      }
      case "empty": {
        const item = new vscode.TreeItem(
          "(no units declared)",
          vscode.TreeItemCollapsibleState.None,
        );
        item.contextValue = "chemag.empty";
        item.iconPath = new vscode.ThemeIcon("info");
        item.tooltip = `compound ${node.compound} has an empty units list`;
        return item;
      }
    }
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      return this.compounds.map<CompoundNode>((c) => ({
        kind: "compound",
        name: c.manifest.compound,
        dir: c.dir,
      }));
    }
    if (node.kind === "compound") {
      const compound = this.compounds.find((c) => c.manifest.compound === node.name);
      if (!compound) return [];
      const units = compound.manifest.units ?? [];
      if (units.length === 0) {
        // Render an explicit placeholder so users see *why* the node is empty
        // (alpha's degenerate manifest shape from the 026b fixture).
        return [
          {
            kind: "empty",
            compound: node.name,
            compoundDir: compound.dir,
          } satisfies EmptyPlaceholderNode,
        ];
      }
      const byRole = new Map<string, UnitDeclaration[]>();
      for (const unit of units) {
        const list = byRole.get(unit.role);
        if (list) list.push(unit);
        else byRole.set(unit.role, [unit]);
      }
      const roleNames = Array.from(byRole.keys()).sort();
      return roleNames.map<RoleNode>((role) => ({
        kind: "role",
        compound: node.name,
        role,
        compoundDir: compound.dir,
        units: byRole.get(role) ?? [],
      }));
    }
    if (node.kind === "role") {
      return node.units.map<UnitNode>((unit) => ({
        kind: "unit",
        compound: node.compound,
        compoundDir: node.compoundDir,
        unit,
      }));
    }
    return [];
  }

  private unitAbsolutePath(node: UnitNode): string {
    return path.resolve(node.compoundDir, node.unit.file);
  }

  private chemagDiagnosticCountForUri(uri: vscode.Uri): number {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    let n = 0;
    for (const d of diagnostics) {
      if (d.source === "chemag") n++;
    }
    return n;
  }

  private unitDiagnosticCount(node: UnitNode): number {
    return this.chemagDiagnosticCountForUri(vscode.Uri.file(this.unitAbsolutePath(node)));
  }

  private compoundDiagnosticCount(node: CompoundNode): number {
    const compound = this.compounds.find((c) => c.manifest.compound === node.name);
    if (!compound) return 0;
    let total = 0;
    for (const unit of compound.manifest.units ?? []) {
      const abs = path.resolve(compound.dir, unit.file);
      total += this.chemagDiagnosticCountForUri(vscode.Uri.file(abs));
    }
    return total;
  }
}

// ---------------------------------------------------------------------------
// Public surface — the entry point extension.ts instantiates.
// ---------------------------------------------------------------------------

export class ChemagTreeView implements vscode.Disposable {
  private readonly subs: vscode.Disposable[] = [];
  private readonly provider: ChemagTreeDataProvider;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(args: { workspaceDir: string; output?: vscode.OutputChannel }) {
    const { workspaceDir, output } = args;
    this.provider = new ChemagTreeDataProvider(workspaceDir, output);

    const treeView = vscode.window.createTreeView<TreeNode>(VIEW_ID, {
      treeDataProvider: this.provider,
      showCollapseAll: true,
    });
    this.subs.push(treeView);

    // 1. Diagnostic-driven badge refresh. Recompute counts only when chemag
    //    sources may have changed; we still pay the small cost of refreshing
    //    the tree because vscode.languages.getDiagnostics is per-URI cheap.
    this.subs.push(
      vscode.languages.onDidChangeDiagnostics((e) => {
        // We could narrow to nodes whose unit file matches one of e.uris, but
        // the v1 implementation prefers correctness over micro-optimisation.
        // The spec explicitly permits `fire(undefined)` here.
        if (e.uris.length === 0) return;
        this.provider.fireChanged();
      }),
    );

    // 2. File-change-driven structure refresh. Debounce so a save followed
    //    by a quick save (or the formatter writing back) doesn't reload twice.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceDir, "**/{workspace,compound}.yaml"),
    );
    const onChange = () => this.scheduleRefresh();
    this.subs.push(
      watcher,
      watcher.onDidCreate(onChange),
      watcher.onDidChange(onChange),
      watcher.onDidDelete(onChange),
    );
  }

  /** Force a re-walk of the workspace + diagnostics snapshot. Public for tests. */
  refresh(): void {
    this.provider.reload();
    this.provider.fireChanged();
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const sub of this.subs) {
      try {
        sub.dispose();
      } catch {
        // best-effort
      }
    }
    this.subs.length = 0;
  }
}
