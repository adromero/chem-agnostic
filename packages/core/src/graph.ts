import type { Workspace, LoadedCompound, LanguageSubtree } from "./types.js";

/**
 * Optional per-sub-tree grouping fed in by the multi-language orchestrator
 * (wp-020). When supplied, each sub-tree is rendered as its own Mermaid
 * `subgraph` cluster, and import edges that cross sub-tree boundaries are
 * rendered as dashed arrows so the language boundary is visible at a glance.
 */
export interface GraphSubtreeGroup {
  scope: LanguageSubtree;
  compounds: LoadedCompound[];
}

export function generateMermaid(
  workspace: Workspace,
  compounds: LoadedCompound[],
  groups?: GraphSubtreeGroup[],
): string {
  const lines: string[] = ["graph LR"];

  // -----------------------------------------------------------------
  // Mode A — multi-sub-tree clustered render. Used when the caller
  // supplies a `groups` argument with at least 2 sub-trees. We render
  // one cluster per sub-tree, group compounds inside the cluster by
  // their type-style as before, and emit dashed edges for cross-sub-tree
  // imports.
  //
  // Mode B — legacy type-grouped render (no `groups` argument or only
  // one sub-tree). Behaves exactly as before so single-language workspaces
  // and existing snapshot tests stay byte-for-byte stable.
  // -----------------------------------------------------------------
  const useClusters = !!(groups && groups.length > 1);

  // Group compounds by type
  const groupsByType = new Map<string, LoadedCompound[]>();
  for (const c of compounds) {
    const t = c.manifest.type ?? "compound";
    if (!groupsByType.has(t)) groupsByType.set(t, []);
    groupsByType.get(t)!.push(c);
  }

  const typeOrder = ["reagent", "solvent", "compound", "catalyst"];
  const typeStyles: Record<string, string> = {
    reagent: "fill:#e8f5e9,stroke:#4caf50",
    solvent: "fill:#e3f2fd,stroke:#2196f3",
    compound: "fill:#fff3e0,stroke:#ff9800",
    catalyst: "fill:#fce4ec,stroke:#e91e63",
  };

  if (useClusters) {
    // One outer subgraph per sub-tree.
    for (const g of groups!) {
      lines.push(
        `  subgraph subtree_${sanitize(g.scope.id)}["${g.scope.id} (${g.scope.language})"]`,
      );
      for (const c of g.compounds) {
        const name = c.manifest.compound;
        const label = c.manifest.description
          ? `${name}\\n${truncate(c.manifest.description, 40)}`
          : name;
        lines.push(`    ${name}["${label}"]`);
      }
      lines.push("  end");
    }
  } else {
    // Render type-grouped subgraphs (legacy behaviour).
    for (const type of typeOrder) {
      const group = groupsByType.get(type);
      if (!group || group.length === 0) continue;

      lines.push(`  subgraph ${type}s["${type}s"]`);
      for (const c of group) {
        const name = c.manifest.compound;
        const label = c.manifest.description
          ? `${name}\\n${truncate(c.manifest.description, 40)}`
          : name;
        lines.push(`    ${name}["${label}"]`);
      }
      lines.push("  end");
    }
  }

  // Style nodes by compound type.
  for (const [type, group] of groupsByType) {
    const style = typeStyles[type];
    if (!style) continue;
    for (const c of group) {
      lines.push(`  style ${c.manifest.compound} ${style}`);
    }
  }

  // ---- Edges ----------------------------------------------------------
  // For multi-sub-tree mode, build a compound -> sub-tree id lookup so we
  // can render dashed arrows for cross-language imports.
  const compoundToSubtree = new Map<string, string>();
  if (useClusters) {
    for (const g of groups!) {
      for (const c of g.compounds) {
        compoundToSubtree.set(c.manifest.compound, g.scope.id);
      }
    }
  }

  // Import edges (solid arrows; cross-sub-tree edges dashed in multi mode).
  const importEdges = new Set<string>();
  for (const c of compounds) {
    for (const imp of c.manifest.imports ?? []) {
      const srcId = compoundToSubtree.get(c.manifest.compound);
      const tgtId = compoundToSubtree.get(imp.compound);
      const isCrossLang =
        useClusters && srcId !== undefined && tgtId !== undefined && srcId !== tgtId;
      const edge = isCrossLang
        ? `${c.manifest.compound} -.-> ${imp.compound}`
        : `${c.manifest.compound} --> ${imp.compound}`;
      if (!importEdges.has(edge)) {
        importEdges.add(edge);
        lines.push(`  ${edge}`);
      }
    }
  }

  // Signal edges (dashed arrows)
  // Build emitter map: signal name -> compound that emits it
  const emitters = new Map<string, string>();
  for (const c of compounds) {
    for (const em of c.manifest.signals?.emits ?? []) {
      emitters.set(em.signal, c.manifest.compound);
    }
  }

  for (const c of compounds) {
    for (const li of c.manifest.signals?.listens ?? []) {
      const from = emitters.get(li.signal);
      if (from) {
        lines.push(`  ${from} -.->|"${li.signal}"| ${c.manifest.compound}`);
      }
    }
  }

  // Wiring edges (dotted from catalyst)
  const wiredCompounds = new Set<string>();
  for (const c of compounds) {
    if ((c.manifest.type ?? "compound") !== "catalyst") continue;
    for (const w of c.manifest.wiring ?? []) {
      if (!wiredCompounds.has(w.compound)) {
        wiredCompounds.add(w.compound);
        lines.push(`  ${c.manifest.compound} -.-o ${w.compound}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Convert a sub-tree id to a Mermaid-safe identifier (alnum + underscore). */
function sanitize(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, "_");
}
