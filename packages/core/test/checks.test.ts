import { describe, it, expect } from "vitest";
import { allChecks } from "../src/checks.js";
import type { Workspace, LoadedCompound, CheckOptions, Compound } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPTS: CheckOptions = { manifestOnly: true };

function ws(overrides?: Partial<Workspace>): Workspace {
  return {
    workspace: "test",
    language: "typescript",
    roles: {
      element: { description: "Value", folder: "elements" },
      molecule: { description: "State", folder: "molecules" },
      reaction: { description: "Workflow", folder: "reactions" },
      interface: { description: "Contract", folder: "interfaces" },
      adapter: { description: "Implementation", folder: "adapters" },
    },
    bonds: {
      element: ["element"],
      molecule: ["element", "molecule"],
      reaction: ["element", "molecule", "interface"],
      interface: ["element", "molecule"],
      adapter: ["element", "molecule", "interface", "adapter"],
    },
    compound_types: {
      compound: {
        description: "Standard",
        importable_by: "all",
        can_import: ["compound", "reagent"],
      },
      reagent: {
        description: "Shared",
        importable_by: "all",
        can_import: ["reagent"],
      },
      solvent: {
        description: "Infra",
        importable_by: "all",
        can_import: ["reagent"],
        implicit: true,
      },
      catalyst: {
        description: "Root",
        importable_by: "none",
        can_import: ["compound", "reagent", "solvent"],
        singleton: true,
        allowed_roles: ["adapter"],
      },
    },
    paths: { compounds: "./src/compounds" },
    rules: { cross_compound_imports: "public_only", role_from_path: true },
    ...overrides,
  };
}

function lc(manifest: Compound, dir = "/tmp/fake"): LoadedCompound {
  return { manifest, dir };
}

function runCheck(name: string, workspace: Workspace, compounds: LoadedCompound[]) {
  const check = allChecks.find((c) => c.name === name);
  if (!check) throw new Error(`Unknown check: ${name}`);
  return check.fn(workspace, compounds, OPTS);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("No duplicate compounds", () => {
  it("passes with unique names", () => {
    const diags = runCheck("No duplicate compounds", ws(), [
      lc({ compound: "a", units: [] }),
      lc({ compound: "b", units: [] }),
    ]);
    expect(diags).toHaveLength(0);
  });

  it("fails with duplicate names", () => {
    const diags = runCheck("No duplicate compounds", ws(), [
      lc({ compound: "a", units: [] }),
      lc({ compound: "a", units: [] }),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].level).toBe("error");
  });
});

describe("Known roles", () => {
  it("passes with valid roles", () => {
    const diags = runCheck("Known roles", ws(), [
      lc({
        compound: "a",
        units: [{ role: "element", name: "X", file: "./elements/X.ts" }],
      }),
    ]);
    expect(diags).toHaveLength(0);
  });

  it("fails with unknown role", () => {
    const diags = runCheck("Known roles", ws(), [
      lc({
        compound: "a",
        units: [{ role: "catalyst", name: "X", file: "./X.ts" }],
      }),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("unknown role");
  });
});

describe("Role-folder alignment", () => {
  it("passes when file is in correct folder", () => {
    const diags = runCheck("Role-folder alignment", ws(), [
      lc({
        compound: "a",
        units: [{ role: "element", name: "X", file: "./elements/X.ts" }],
      }),
    ]);
    expect(diags).toHaveLength(0);
  });

  it("fails when file is in wrong folder", () => {
    const diags = runCheck("Role-folder alignment", ws(), [
      lc({
        compound: "a",
        units: [{ role: "element", name: "X", file: "./reactions/X.ts" }],
      }),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("elements");
  });
});

describe("Export consistency", () => {
  it("passes when exports match units", () => {
    const diags = runCheck("Export consistency", ws(), [
      lc({
        compound: "a",
        exports: { elements: ["X"] },
        units: [{ role: "element", name: "X", file: "./elements/X.ts" }],
      }),
    ]);
    expect(diags).toHaveLength(0);
  });

  it("fails when export has no matching unit", () => {
    const diags = runCheck("Export consistency", ws(), [
      lc({
        compound: "a",
        exports: { elements: ["X"] },
        units: [],
      }),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("no matching unit");
  });
});

describe("Import existence", () => {
  it("passes when imported compound exists", () => {
    const diags = runCheck("Import existence", ws(), [
      lc({
        compound: "a",
        imports: [{ compound: "b" }],
        units: [],
      }),
      lc({ compound: "b", units: [] }),
    ]);
    expect(diags).toHaveLength(0);
  });

  it("fails when imported compound is missing", () => {
    const diags = runCheck("Import existence", ws(), [
      lc({
        compound: "a",
        imports: [{ compound: "missing" }],
        units: [],
      }),
    ]);
    expect(diags).toHaveLength(1);
  });
});

describe("Import specificity", () => {
  it("fails when importing a unit not in exports", () => {
    const diags = runCheck("Import specificity", ws(), [
      lc({
        compound: "a",
        imports: [{ compound: "b", units: ["Hidden"] }],
        units: [],
      }),
      lc({
        compound: "b",
        exports: { elements: ["Public"] },
        units: [{ role: "element", name: "Public", file: "./elements/Public.ts" }],
      }),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("not exported");
  });
});

describe("Compound type imports", () => {
  it("fails when reagent imports a compound", () => {
    const diags = runCheck("Compound type imports", ws(), [
      lc({
        compound: "shared",
        type: "reagent",
        imports: [{ compound: "feature" }],
        units: [],
      }),
      lc({ compound: "feature", units: [] }),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("reagent may only import");
  });

  it("fails when importing a non-importable type", () => {
    const diags = runCheck("Compound type imports", ws(), [
      lc({
        compound: "a",
        imports: [{ compound: "root" }],
        units: [],
      }),
      lc({ compound: "root", type: "catalyst", units: [] }),
    ]);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags.some((d) => d.message.includes("not importable"))).toBe(true);
  });
});

describe("Bond rules", () => {
  it("passes with valid dependencies", () => {
    const diags = runCheck("Bond rules", ws(), [
      lc({
        compound: "a",
        units: [
          { role: "element", name: "X", file: "./elements/X.ts" },
          {
            role: "molecule",
            name: "Y",
            file: "./molecules/Y.ts",
            depends_on: ["X"],
          },
        ],
      }),
    ]);
    expect(diags).toHaveLength(0);
  });

  it("fails when element depends on reaction", () => {
    const diags = runCheck("Bond rules", ws(), [
      lc({
        compound: "a",
        units: [
          { role: "reaction", name: "DoThing", file: "./reactions/DoThing.ts" },
          {
            role: "element",
            name: "X",
            file: "./elements/X.ts",
            depends_on: ["DoThing"],
          },
        ],
      }),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("bond violation");
  });

  it("resolves dependencies from implicit solvents", () => {
    const diags = runCheck("Bond rules", ws(), [
      lc({
        compound: "logging",
        type: "solvent",
        exports: { interfaces: ["Logger"] },
        units: [{ role: "interface", name: "Logger", file: "./interfaces/Logger.ts" }],
      }),
      lc({
        compound: "a",
        units: [
          {
            role: "reaction",
            name: "DoThing",
            file: "./reactions/DoThing.ts",
            depends_on: ["Logger"],
          },
        ],
      }),
    ]);
    expect(diags).toHaveLength(0);
  });

  it("fails for unresolvable dependencies", () => {
    const diags = runCheck("Bond rules", ws(), [
      lc({
        compound: "a",
        units: [
          {
            role: "reaction",
            name: "DoThing",
            file: "./reactions/DoThing.ts",
            depends_on: ["Ghost"],
          },
        ],
      }),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("cannot be resolved");
  });
});

describe("Signal consistency", () => {
  it("passes with matching emitter and listener", () => {
    const diags = runCheck("Signal consistency", ws(), [
      lc({
        compound: "a",
        units: [{ role: "reaction", name: "doA", file: "./reactions/doA.ts" }],
        signals: {
          emits: [{ signal: "a.done", emitted_by: "doA" }],
        },
      }),
      lc({
        compound: "b",
        units: [{ role: "reaction", name: "onA", file: "./reactions/onA.ts" }],
        signals: {
          listens: [{ signal: "a.done", handler: "onA" }],
        },
      }),
    ]);
    expect(diags).toHaveLength(0);
  });

  it("warns about orphaned listener", () => {
    const diags = runCheck("Signal consistency", ws(), [
      lc({
        compound: "b",
        units: [{ role: "reaction", name: "onA", file: "./reactions/onA.ts" }],
        signals: {
          listens: [{ signal: "never.emitted", handler: "onA" }],
        },
      }),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].level).toBe("warning");
  });

  it("fails when emitter references non-reaction", () => {
    const diags = runCheck("Signal consistency", ws(), [
      lc({
        compound: "a",
        units: [{ role: "element", name: "X", file: "./elements/X.ts" }],
        signals: {
          emits: [{ signal: "x.done", emitted_by: "X" }],
        },
      }),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].level).toBe("error");
  });
});

describe("Wiring validity", () => {
  it("passes with valid wiring", () => {
    const diags = runCheck("Wiring validity", ws(), [
      lc({
        compound: "root",
        type: "catalyst",
        wiring: [{ interface: "Repo", adapter: "PgRepo", compound: "a" }],
        units: [],
      }),
      lc({
        compound: "a",
        units: [
          { role: "interface", name: "Repo", file: "./interfaces/Repo.ts" },
          {
            role: "adapter",
            name: "PgRepo",
            file: "./adapters/PgRepo.ts",
            implements: ["Repo"],
          },
        ],
      }),
    ]);
    expect(diags).toHaveLength(0);
  });

  it("fails when adapter does not implement interface", () => {
    const diags = runCheck("Wiring validity", ws(), [
      lc({
        compound: "root",
        type: "catalyst",
        wiring: [{ interface: "Repo", adapter: "PgRepo", compound: "a" }],
        units: [],
      }),
      lc({
        compound: "a",
        units: [
          { role: "interface", name: "Repo", file: "./interfaces/Repo.ts" },
          { role: "adapter", name: "PgRepo", file: "./adapters/PgRepo.ts" },
        ],
      }),
    ]);
    expect(diags.some((d) => d.message.includes("does not declare"))).toBe(true);
  });
});

describe("Singleton constraints", () => {
  it("fails with two catalysts", () => {
    const diags = runCheck("Singleton constraints", ws(), [
      lc({ compound: "cat1", type: "catalyst", units: [] }),
      lc({ compound: "cat2", type: "catalyst", units: [] }),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("singleton");
  });
});

describe("Role restrictions", () => {
  it("fails when catalyst has a reaction", () => {
    const diags = runCheck("Role restrictions", ws(), [
      lc({
        compound: "root",
        type: "catalyst",
        units: [{ role: "reaction", name: "boot", file: "./reactions/boot.ts" }],
      }),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("only allows");
  });
});

describe("Assay references", () => {
  it("warns when subject is not a unit", () => {
    const diags = runCheck("Assay references", ws(), [
      lc({
        compound: "a",
        units: [],
        assays: [{ name: "Ghost.test", file: "./assays/Ghost.test.ts", subjects: ["Ghost"] }],
      }),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].level).toBe("warning");
  });
});
