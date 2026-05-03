import { describe, it, expect } from "vitest";
import { generateMermaid } from "../src/graph.js";
import type { Workspace, LoadedCompound } from "../src/types.js";

function minWs(): Workspace {
  return {
    workspace: "test",
    language: "typescript",
    roles: {
      element: { description: "Value", folder: "elements" },
      reaction: { description: "Workflow", folder: "reactions" },
      interface: { description: "Contract", folder: "interfaces" },
      adapter: { description: "Impl", folder: "adapters" },
    },
    bonds: {
      element: ["element"],
      reaction: ["element", "interface"],
      interface: ["element"],
      adapter: ["element", "interface", "adapter"],
    },
    paths: { compounds: "./src/compounds" },
  };
}

function lc(name: string, overrides?: Partial<LoadedCompound["manifest"]>): LoadedCompound {
  return {
    dir: `/tmp/${name}`,
    manifest: { compound: name, units: [], ...overrides },
  };
}

describe("generateMermaid", () => {
  it("starts with graph LR", () => {
    const output = generateMermaid(minWs(), []);
    expect(output.startsWith("graph LR")).toBe(true);
  });

  it("renders import edges", () => {
    const output = generateMermaid(minWs(), [lc("a", { imports: [{ compound: "b" }] }), lc("b")]);
    expect(output).toContain("a --> b");
  });

  it("renders signal edges as dashed", () => {
    const output = generateMermaid(minWs(), [
      lc("a", {
        units: [{ role: "reaction", name: "doA", file: "./reactions/doA.ts" }],
        signals: { emits: [{ signal: "a.done", emitted_by: "doA" }] },
      }),
      lc("b", {
        units: [{ role: "reaction", name: "onA", file: "./reactions/onA.ts" }],
        signals: { listens: [{ signal: "a.done", handler: "onA" }] },
      }),
    ]);
    expect(output).toContain("-.->");
    expect(output).toContain("a.done");
  });

  it("renders catalyst wiring", () => {
    const output = generateMermaid(minWs(), [
      lc("root", {
        type: "catalyst",
        wiring: [{ interface: "Repo", adapter: "PgRepo", compound: "a" }],
      }),
      lc("a"),
    ]);
    expect(output).toContain("root -.-o a");
  });

  it("groups by compound type in subgraphs", () => {
    const output = generateMermaid(minWs(), [lc("shared", { type: "reagent" }), lc("feature")]);
    expect(output).toContain("subgraph reagents");
    expect(output).toContain("subgraph compounds");
  });

  // -----------------------------------------------------------------
  // wp-020 — multi-sub-tree cluster mode.
  // -----------------------------------------------------------------
  it("renders one Mermaid subgraph cluster per language sub-tree (wp-020)", () => {
    const webA = lc("web_orders", { imports: [{ compound: "api_orders" }] });
    const apiA = lc("api_orders");
    const output = generateMermaid(
      minWs(),
      [webA, apiA],
      [
        {
          scope: {
            id: "web",
            language: "typescript",
            paths: { compounds: "./apps/web/compounds" },
          },
          compounds: [webA],
        },
        {
          scope: { id: "api", language: "python", paths: { compounds: "./apps/api/compounds" } },
          compounds: [apiA],
        },
      ],
    );
    expect(output).toContain('subgraph subtree_web["web (typescript)"]');
    expect(output).toContain('subgraph subtree_api["api (python)"]');
  });

  it("renders cross-sub-tree import edges as dashed arrows (wp-020)", () => {
    const webA = lc("web_orders", { imports: [{ compound: "api_orders" }] });
    const apiA = lc("api_orders");
    const output = generateMermaid(
      minWs(),
      [webA, apiA],
      [
        {
          scope: {
            id: "web",
            language: "typescript",
            paths: { compounds: "./apps/web/compounds" },
          },
          compounds: [webA],
        },
        {
          scope: { id: "api", language: "python", paths: { compounds: "./apps/api/compounds" } },
          compounds: [apiA],
        },
      ],
    );
    // Cross-sub-tree edge uses dashed `-.->` instead of solid `-->`.
    expect(output).toContain("web_orders -.-> api_orders");
    expect(output).not.toContain("web_orders --> api_orders");
  });

  it("falls through to legacy type-grouped render when only one sub-tree is supplied", () => {
    const a = lc("a");
    const output = generateMermaid(
      minWs(),
      [a],
      [
        {
          scope: { id: "default", language: "typescript", paths: { compounds: "./compounds" } },
          compounds: [a],
        },
      ],
    );
    // Single-sub-tree input must NOT switch into cluster mode (byte-stable
    // for legacy single-language workspaces).
    expect(output).not.toContain("subgraph subtree_default");
    expect(output).toContain("subgraph compounds");
  });
});
