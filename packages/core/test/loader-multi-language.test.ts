// ---------------------------------------------------------------------------
// wp-019: Multi-language workspace schema — loader + checks coverage.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { stringify } from "yaml";
import { loadWorkspace, discoverCompounds } from "../src/loader.js";
import { allChecks } from "../src/checks.js";
import type { CheckOptions, LanguageSubtree, Workspace } from "../src/types.js";

const OPTS: CheckOptions = { manifestOnly: true };

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-loader-multi-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeWorkspaceYaml(obj: unknown): string {
  const wsPath = path.join(tmpDir, "workspace.yaml");
  fs.writeFileSync(wsPath, stringify(obj), "utf-8");
  return wsPath;
}

function baseWorkspace(): Record<string, unknown> {
  return {
    workspace: "multi",
    roles: {
      element: { description: "Value", folder: "elements" },
      molecule: { description: "State", folder: "molecules" },
    },
    bonds: { element: ["element"], molecule: ["element", "molecule"] },
  };
}

describe("wp-019 — loader: multi-language schema", () => {
  it("parses a 3-sub-tree workspace and derives ws.language + ws.paths from languages[0]", () => {
    const wsPath = writeWorkspaceYaml({
      ...baseWorkspace(),
      languages: [
        {
          id: "web",
          language: "typescript",
          paths: { compounds: "./apps/web/src/compounds" },
          public_surface: "public.ts",
        },
        {
          id: "api",
          language: "python",
          paths: { compounds: "./apps/api/src/compounds" },
          public_surface: "__init__.py",
          python_packages: ["api.compounds"],
        },
        {
          id: "worker",
          language: "go",
          paths: { compounds: "./apps/worker/compounds" },
          public_surface: "public.go",
          go_module_root: "./apps/worker",
        },
      ],
    });

    const ws = loadWorkspace(wsPath);

    expect(ws.languages).toHaveLength(3);
    // Derived-fields invariant: legacy fields are populated from languages[0].
    expect(ws.language).toBe("typescript");
    expect(ws.paths).toBe(ws.languages![0].paths);
    expect(ws.paths.compounds).toBe("./apps/web/src/compounds");

    // Sub-tree-level metadata is preserved.
    expect(ws.languages![1].language).toBe("python");
    expect(ws.languages![1].python_packages).toEqual(["api.compounds"]);
    expect(ws.languages![2].language).toBe("go");
    expect(ws.languages![2].go_module_root).toBe("./apps/worker");
  });

  it("parses a workspace that omits the legacy paths block when languages: is supplied", () => {
    // The arbiter-flagged regression: prior to wp-019 the loader's
    // unconditional `paths.compounds` guard would crash on this shape.
    const wsPath = writeWorkspaceYaml({
      ...baseWorkspace(),
      languages: [
        {
          id: "only",
          language: "typescript",
          paths: { compounds: "./src/compounds" },
        },
      ],
    });

    expect(() => loadWorkspace(wsPath)).not.toThrow();
    const ws = loadWorkspace(wsPath);
    expect(ws.language).toBe("typescript");
    expect(ws.paths.compounds).toBe("./src/compounds");
  });

  it("synthesizes a one-element languages array for a legacy single-language workspace", () => {
    const wsPath = writeWorkspaceYaml({
      ...baseWorkspace(),
      language: "typescript",
      paths: { compounds: "./src/compounds" },
    });

    const ws = loadWorkspace(wsPath);
    expect(ws.languages).toHaveLength(1);
    const sub = ws.languages![0];
    expect(sub.id).toBe("default");
    expect(sub.language).toBe("typescript");
    expect(sub.paths.compounds).toBe("./src/compounds");
  });

  it("rejects a multi-language workspace whose sub-tree omits id/language/paths.compounds", () => {
    const wsPath = writeWorkspaceYaml({
      ...baseWorkspace(),
      languages: [
        {
          id: "web",
          language: "typescript",
          paths: { compounds: "./apps/web/src/compounds" },
        },
        {
          // missing id
          language: "python",
          paths: { compounds: "./apps/api/src/compounds" },
        },
      ],
    });
    expect(() => loadWorkspace(wsPath)).toThrow(/languages\[1\]\.id/);
  });
});

describe("wp-019 — discoverCompounds: iterates every sub-tree", () => {
  function writeCompound(rel: string, name: string): void {
    const dir = path.join(tmpDir, rel, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "compound.yaml"), stringify({ compound: name }), "utf-8");
  }

  it("returns the union of compounds across all declared sub-trees", () => {
    writeCompound("apps/web/src/compounds", "billing");
    writeCompound("apps/web/src/compounds", "auth");
    writeCompound("apps/api/src/compounds", "users");
    writeCompound("apps/worker/compounds", "scheduler");

    const wsPath = writeWorkspaceYaml({
      ...baseWorkspace(),
      languages: [
        {
          id: "web",
          language: "typescript",
          paths: { compounds: "./apps/web/src/compounds" },
        },
        {
          id: "api",
          language: "python",
          paths: { compounds: "./apps/api/src/compounds" },
        },
        {
          id: "worker",
          language: "typescript",
          paths: { compounds: "./apps/worker/compounds" },
        },
      ],
    });

    const ws = loadWorkspace(wsPath);
    const compounds = discoverCompounds(ws, tmpDir);

    const names = compounds.map((c) => c.manifest.compound).sort();
    expect(names).toEqual(["auth", "billing", "scheduler", "users"]);
  });

  it("still discovers compounds in legacy single-language workspaces", () => {
    writeCompound("src/compounds", "alpha");
    writeCompound("src/compounds", "beta");

    const wsPath = writeWorkspaceYaml({
      ...baseWorkspace(),
      language: "typescript",
      paths: { compounds: "./src/compounds" },
    });

    const ws = loadWorkspace(wsPath);
    const compounds = discoverCompounds(ws, tmpDir);
    expect(compounds.map((c) => c.manifest.compound).sort()).toEqual(["alpha", "beta"]);
  });
});

describe("wp-019 — checks: sub-tree path overlap (CHEM-MANIFEST-003)", () => {
  function ws(languages: LanguageSubtree[]): {
    workspace: string;
    language: string;
    roles: Record<string, { description: string; folder: string }>;
    bonds: Record<string, string[]>;
    paths: { compounds: string };
    languages: LanguageSubtree[];
  } {
    return {
      workspace: "multi",
      language: languages[0].language,
      roles: {
        element: { description: "v", folder: "elements" },
      },
      bonds: { element: ["element"] },
      paths: languages[0].paths,
      languages,
    };
  }

  function runOverlap(languages: LanguageSubtree[]): ReturnType<(typeof allChecks)[number]["fn"]> {
    const check = allChecks.find((c) => c.name === "Sub-tree path overlap");
    if (!check) throw new Error("missing check");
    return check.fn(ws(languages) as Workspace, [], OPTS);
  }

  it("passes when sub-tree paths are disjoint", () => {
    const diags = runOverlap([
      { id: "web", language: "typescript", paths: { compounds: "./apps/web/src/compounds" } },
      { id: "api", language: "python", paths: { compounds: "./apps/api/src/compounds" } },
    ]);
    expect(diags).toHaveLength(0);
  });

  it("flags identical compounds roots between two sub-trees with CHEM-MANIFEST-003", () => {
    const diags = runOverlap([
      { id: "web", language: "typescript", paths: { compounds: "./apps/shared/compounds" } },
      { id: "api", language: "python", paths: { compounds: "./apps/shared/compounds" } },
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("CHEM-MANIFEST-003");
    expect(diags[0].level).toBe("error");
    // Message identifies both sub-tree ids and the offending paths.
    expect(diags[0].message).toContain("web");
    expect(diags[0].message).toContain("api");
    expect(diags[0].message).toContain("./apps/shared/compounds");
  });

  it("flags ancestor/descendant overlap and emits exactly one error per pair", () => {
    const diags = runOverlap([
      {
        id: "web",
        language: "typescript",
        paths: { compounds: "./apps/web/src/compounds", reagents: "./apps/web/src/reagents" },
      },
      // api's compounds nests INSIDE web's compounds — overlap.
      {
        id: "api",
        language: "python",
        paths: { compounds: "./apps/web/src/compounds/nested" },
      },
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("CHEM-MANIFEST-003");
  });

  it("is a no-op for the synthesized legacy single-language workspace", () => {
    const diags = runOverlap([
      { id: "default", language: "typescript", paths: { compounds: "./src/compounds" } },
    ]);
    expect(diags).toHaveLength(0);
  });
});

describe("wp-019 — checks: sub-tree id duplicate (CHEM-MANIFEST-004)", () => {
  function ws(languages: LanguageSubtree[]): {
    workspace: string;
    language: string;
    roles: Record<string, { description: string; folder: string }>;
    bonds: Record<string, string[]>;
    paths: { compounds: string };
    languages: LanguageSubtree[];
  } {
    return {
      workspace: "multi",
      language: languages[0].language,
      roles: { element: { description: "v", folder: "elements" } },
      bonds: { element: ["element"] },
      paths: languages[0].paths,
      languages,
    };
  }

  function runDup(languages: LanguageSubtree[]): ReturnType<(typeof allChecks)[number]["fn"]> {
    const check = allChecks.find((c) => c.name === "Sub-tree id duplicates");
    if (!check) throw new Error("missing check");
    return check.fn(ws(languages) as Workspace, [], OPTS);
  }

  it("flags two sub-trees sharing the same id", () => {
    const diags = runDup([
      { id: "shared", language: "typescript", paths: { compounds: "./a" } },
      { id: "shared", language: "python", paths: { compounds: "./b" } },
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("CHEM-MANIFEST-004");
    expect(diags[0].level).toBe("error");
    expect(diags[0].message).toContain("shared");
  });

  it("passes when ids are unique", () => {
    const diags = runDup([
      { id: "web", language: "typescript", paths: { compounds: "./a" } },
      { id: "api", language: "python", paths: { compounds: "./b" } },
    ]);
    expect(diags).toHaveLength(0);
  });

  it("is a no-op for the synthesized legacy single-language workspace", () => {
    const diags = runDup([
      { id: "default", language: "typescript", paths: { compounds: "./src/compounds" } },
    ]);
    expect(diags).toHaveLength(0);
  });
});

describe("wp-019 — backwards compat: legacy workspaces emit zero new diagnostics", () => {
  it("running ALL checks on a legacy single-language workspace produces 0 manifest-003/004 diagnostics", () => {
    const wsPath = writeWorkspaceYaml({
      ...baseWorkspace(),
      language: "typescript",
      paths: { compounds: "./src/compounds" },
    });
    const ws = loadWorkspace(wsPath);

    let total: ReturnType<(typeof allChecks)[number]["fn"]> = [];
    for (const { fn } of allChecks) {
      total = total.concat(fn(ws, [], OPTS));
    }
    const newDiags = total.filter(
      (d) => d.code === "CHEM-MANIFEST-003" || d.code === "CHEM-MANIFEST-004",
    );
    expect(newDiags).toHaveLength(0);
  });
});
