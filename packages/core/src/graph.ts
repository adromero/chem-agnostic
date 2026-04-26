import type { Workspace, LoadedCompound } from "./types.js";

export function generateMermaid(workspace: Workspace, compounds: LoadedCompound[]): string {
  const lines: string[] = ["graph LR"];

  // Group compounds by type
  const groups = new Map<string, LoadedCompound[]>();
  for (const c of compounds) {
    const t = c.manifest.type ?? "compound";
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(c);
  }

  // Render subgraphs
  const typeOrder = ["reagent", "solvent", "compound", "catalyst"];
  const typeStyles: Record<string, string> = {
    reagent: "fill:#e8f5e9,stroke:#4caf50",
    solvent: "fill:#e3f2fd,stroke:#2196f3",
    compound: "fill:#fff3e0,stroke:#ff9800",
    catalyst: "fill:#fce4ec,stroke:#e91e63",
  };

  for (const type of typeOrder) {
    const group = groups.get(type);
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

  // Style nodes
  for (const [type, group] of groups) {
    const style = typeStyles[type];
    if (!style) continue;
    for (const c of group) {
      lines.push(`  style ${c.manifest.compound} ${style}`);
    }
  }

  // Import edges (solid arrows)
  const importEdges = new Set<string>();
  for (const c of compounds) {
    for (const imp of c.manifest.imports ?? []) {
      const edge = `${c.manifest.compound} --> ${imp.compound}`;
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
