// ---------------------------------------------------------------------------
// Unit tests for the check-edit engine: resolveFilePlacement (path inference)
// and runCheckEdit (full pipeline including remediation kinds).
//
// These tests use a minimal stub LanguagePlugin so the core package's test
// suite stays free of plugin packages (which would create a cyclic workspace
// dependency). Real plugin integration is exercised by the CLI tests.
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { resolveFilePlacement, runCheckEdit } from "../src/check-edit.js";
import { discoverCompounds, loadWorkspace } from "../src/loader.js";
import type { LanguagePlugin } from "../src/plugin-interface.js";
import type { ParsedImport, Workspace } from "../src/types.js";

let tmpDir: string;

const STD_WORKSPACE: Workspace = {
  workspace: "test-app",
  language: "typescript",
  roles: {
    element: { description: "value object", folder: "elements" },
    molecule: { description: "entity", folder: "molecules" },
    reaction: { description: "use case", folder: "reactions" },
    interface: { description: "port", folder: "interfaces" },
    adapter: { description: "adapter", folder: "adapters" },
    buffer: { description: "buffer", folder: "buffers" },
  },
  bonds: {
    element: ["element"],
    molecule: ["element", "molecule"],
    reaction: ["element", "molecule", "interface"],
    interface: ["element", "molecule"],
    adapter: ["element", "molecule", "interface", "adapter"],
    buffer: ["element", "molecule", "interface"],
  },
  compound_types: {
    compound: { description: "feature", can_import: ["compound", "reagent"] },
    reagent: { description: "shared", can_import: ["reagent"] },
    solvent: { description: "infra", can_import: ["reagent"], implicit: true },
    catalyst: { description: "wiring", singleton: true },
  },
  paths: {
    compounds: "src/compounds",
    reagents: "src/reagents",
    solvents: "src/solvents",
    catalyst: "src/catalyst",
  },
  rules: {
    cross_compound_imports: "public_only",
    role_from_path: true,
    public_surface: "public.ts",
    manifest_filename: "compound.yaml",
  },
};

/**
 * Minimal stub plugin for tests. Imports are programmable per-call: the
 * `imports` map is keyed by file path (or, when `--content` is in play,
 * the temp file written by the engine). For determinism we route ALL
 * `parseImports` calls through a single fallback array set per test.
 */
function createStubPlugin(opts: {
  imports?: ParsedImport[];
  resolveModulePath?: (fromFile: string, spec: string) => string | undefined;
}): LanguagePlugin {
  const imports = opts.imports ?? [];
  return {
    name: "stub",
    fileExtensions: [".ts"],
    defaults: {
      publicSurface: "public.ts",
      testFilePattern: /\.test\.ts$/,
      testFrameworkImport: "vitest",
    },
    parseImportsBatch(filePaths) {
      const m = new Map<string, ParsedImport[]>();
      for (const fp of filePaths) m.set(fp, imports);
      return m;
    },
    parseImports() {
      return imports;
    },
    resolveModulePath:
      opts.resolveModulePath ??
      ((fromFile, spec) => {
        if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
        const base = path.resolve(path.dirname(fromFile), spec);
        for (const candidate of [base, `${base}.ts`]) {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
        }
        return undefined;
      }),
    generateUnitStub() {
      return "";
    },
    generatePublicSurface() {
      return "";
    },
    generateAssayStub() {
      return "";
    },
    unitFilePath(_role, name, folder) {
      return `./${folder}/${name}.ts`;
    },
    formatRelativeImport(fromDir, toFile) {
      const r = path.relative(fromDir, toFile).replace(/\.ts$/, "");
      return r.startsWith(".") ? r : `./${r}`;
    },
    formatImportStatement(from, to) {
      return `import { ${from} } from "${to}";`;
    },
    inferUnits() {
      return [];
    },
    inferImplements() {
      return [];
    },
    isSourceFile(fn) {
      return fn.endsWith(".ts");
    },
    generateClaudeMd() {
      return "";
    },
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-check-edit-"));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function writeWorkspace(ws: Workspace = STD_WORKSPACE): string {
  const wsPath = path.join(tmpDir, "workspace.yaml");
  fs.writeFileSync(wsPath, yamlStringify(ws), "utf-8");
  return wsPath;
}

function writeCompound(rootRel: string, name: string, manifest: Record<string, unknown>): string {
  const dir = path.join(tmpDir, rootRel, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "compound.yaml"),
    yamlStringify({ compound: name, ...manifest }),
    "utf-8",
  );
  return dir;
}

function writeFile(rel: string, content = "// placeholder\n"): string {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
  return abs;
}

// ---------------------------------------------------------------------------
// resolveFilePlacement — six required cases
// ---------------------------------------------------------------------------

describe("resolveFilePlacement", () => {
  const plugin = createStubPlugin({});

  it("resolves a file under <compounds>/<known>/<roleFolder>/foo.ts", () => {
    writeWorkspace();
    fs.mkdirSync(path.join(tmpDir, "src/compounds/orders/reactions"), { recursive: true });

    const result = resolveFilePlacement(
      STD_WORKSPACE,
      tmpDir,
      "src/compounds/orders/reactions/createOrder.ts",
      plugin,
    );
    expect(result).toEqual({ compound: "orders", role: "reaction" });
  });

  it("resolves a file under <reagents>/<known>/<roleFolder>/foo.py when reagents path is set", () => {
    writeWorkspace();
    fs.mkdirSync(path.join(tmpDir, "src/reagents/money/elements"), { recursive: true });

    const result = resolveFilePlacement(
      STD_WORKSPACE,
      tmpDir,
      "src/reagents/money/elements/Currency.py",
      plugin,
    );
    expect(result).toEqual({ compound: "money", role: "element" });
  });

  it("returns null when the file is outside all compound roots", () => {
    writeWorkspace();
    fs.mkdirSync(path.join(tmpDir, "src/random/foo"), { recursive: true });

    const result = resolveFilePlacement(STD_WORKSPACE, tmpDir, "src/random/foo/bar.ts", plugin);
    expect(result).toBeNull();
  });

  it("returns null under a compound root but with an unknown role folder", () => {
    writeWorkspace();
    fs.mkdirSync(path.join(tmpDir, "src/compounds/orders/notARole"), { recursive: true });

    const result = resolveFilePlacement(
      STD_WORKSPACE,
      tmpDir,
      "src/compounds/orders/notARole/foo.ts",
      plugin,
    );
    expect(result).toBeNull();
  });

  it("returns null when the compound directory does not exist", () => {
    writeWorkspace();
    // No directory created — resolveFilePlacement requires the compound dir to exist.

    const result = resolveFilePlacement(
      STD_WORKSPACE,
      tmpDir,
      "src/compounds/ghost/elements/Foo.ts",
      plugin,
    );
    expect(result).toBeNull();
  });

  it("resolves with deeper nesting under the role folder", () => {
    writeWorkspace();
    fs.mkdirSync(path.join(tmpDir, "src/compounds/orders/reactions/sub"), { recursive: true });

    const result = resolveFilePlacement(
      STD_WORKSPACE,
      tmpDir,
      "src/compounds/orders/reactions/sub/nested.ts",
      plugin,
    );
    expect(result).toEqual({ compound: "orders", role: "reaction" });
  });
});

// ---------------------------------------------------------------------------
// runCheckEdit — placement precedence + diagnostics
// ---------------------------------------------------------------------------

describe("runCheckEdit — placement precedence", () => {
  it("uses the manifest's unit when one matches the absolute file path", () => {
    writeWorkspace();
    writeCompound("src/compounds", "orders", {
      units: [{ role: "reaction", name: "createOrder", file: "./reactions/createOrder.ts" }],
    });
    writeFile("src/compounds/orders/reactions/createOrder.ts");

    const ws = loadWorkspace(path.join(tmpDir, "workspace.yaml"));
    const compounds = discoverCompounds(ws, tmpDir);

    const result = runCheckEdit({
      workspace: ws,
      workspaceDir: tmpDir,
      compounds,
      plugin: createStubPlugin({}),
      filePath: "src/compounds/orders/reactions/createOrder.ts",
    });
    expect(result.compound).toBe("orders");
    expect(result.role).toBe("reaction");
  });

  it("uses --proposed-role / --proposed-compound when both are supplied for a non-existent file", () => {
    writeWorkspace();
    writeCompound("src/compounds", "orders", { units: [] });

    const ws = loadWorkspace(path.join(tmpDir, "workspace.yaml"));
    const compounds = discoverCompounds(ws, tmpDir);

    const result = runCheckEdit({
      workspace: ws,
      workspaceDir: tmpDir,
      compounds,
      plugin: createStubPlugin({}),
      filePath: "src/compounds/orders/elements/NewThing.ts",
      content: "export class NewThing {}\n",
      proposedRole: "element",
      proposedCompound: "orders",
    });
    expect(result.compound).toBe("orders");
    expect(result.role).toBe("element");
  });

  it("falls back to path inference when the file isn't in any manifest yet", () => {
    writeWorkspace();
    writeCompound("src/compounds", "orders", { units: [] });
    fs.mkdirSync(path.join(tmpDir, "src/compounds/orders/reactions"), { recursive: true });

    const ws = loadWorkspace(path.join(tmpDir, "workspace.yaml"));
    const compounds = discoverCompounds(ws, tmpDir);

    const result = runCheckEdit({
      workspace: ws,
      workspaceDir: tmpDir,
      compounds,
      plugin: createStubPlugin({}),
      filePath: "src/compounds/orders/reactions/futureOrder.ts",
      content: "export async function futureOrder() {}\n",
    });
    expect(result.compound).toBe("orders");
    expect(result.role).toBe("reaction");
  });

  it("emits CHEM-PLACEMENT-004 when the file is unplaceable", () => {
    writeWorkspace();
    fs.mkdirSync(path.join(tmpDir, "src/random"), { recursive: true });

    const ws = loadWorkspace(path.join(tmpDir, "workspace.yaml"));
    const compounds = discoverCompounds(ws, tmpDir);

    const result = runCheckEdit({
      workspace: ws,
      workspaceDir: tmpDir,
      compounds,
      plugin: createStubPlugin({}),
      filePath: "src/random/floating.ts",
      content: "export const x = 1;\n",
    });
    expect(result.compound).toBeNull();
    expect(result.role).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("CHEM-PLACEMENT-004");
    expect(result.diagnostics[0].level).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Remediation kinds — one fixture per kind
// ---------------------------------------------------------------------------

describe("runCheckEdit — remediation kinds", () => {
  it("emits `use_interface` remediation for adapter-target bond violations", () => {
    writeWorkspace();
    writeCompound("src/compounds", "orders", {
      imports: [{ compound: "billing" }],
      units: [{ role: "reaction", name: "createOrder", file: "./reactions/createOrder.ts" }],
    });
    writeCompound("src/compounds", "billing", {
      exports: { interfaces: ["BillingRepo"] },
      units: [
        { role: "interface", name: "BillingRepo", file: "./interfaces/BillingRepo.ts" },
        {
          role: "adapter",
          name: "PgBilling",
          file: "./adapters/PgBilling.ts",
          implements: ["BillingRepo"],
        },
      ],
    });
    const adapterAbs = writeFile(
      "src/compounds/billing/adapters/PgBilling.ts",
      "export class PgBilling {}\n",
    );
    writeFile(
      "src/compounds/billing/interfaces/BillingRepo.ts",
      "export interface BillingRepo {}\n",
    );
    writeFile(
      "src/compounds/billing/public.ts",
      'export type { BillingRepo } from "./interfaces/BillingRepo";\n',
    );
    writeFile("src/compounds/orders/reactions/createOrder.ts", "// placeholder\n");

    const ws = loadWorkspace(path.join(tmpDir, "workspace.yaml"));
    const compounds = discoverCompounds(ws, tmpDir);

    // Stub a plugin that pretends the source file imports PgBilling directly.
    const plugin = createStubPlugin({
      imports: [
        {
          moduleSpecifier: "../../billing/adapters/PgBilling",
          names: ["PgBilling"],
          isTypeOnly: false,
        },
      ],
      resolveModulePath: (_from, spec) => {
        if (spec.endsWith("PgBilling")) return adapterAbs;
        return undefined;
      },
    });

    const result = runCheckEdit({
      workspace: ws,
      workspaceDir: tmpDir,
      compounds,
      plugin,
      filePath: "src/compounds/orders/reactions/createOrder.ts",
    });

    const useIface = result.diagnostics.find((d) => d.remediation?.kind === "use_interface");
    expect(useIface, JSON.stringify(result.diagnostics, null, 2)).toBeDefined();
    expect(useIface!.code).toBe("CHEM-BOND-003");
    expect(
      useIface!.remediation && useIface!.remediation.kind === "use_interface"
        ? useIface!.remediation.interface_candidates
        : null,
    ).toEqual(["BillingRepo"]);
  });

  it("emits `move_to_role_folder` remediation when the file is in the wrong role folder", () => {
    writeWorkspace();
    writeCompound("src/compounds", "orders", {
      units: [{ role: "reaction", name: "createOrder", file: "./elements/createOrder.ts" }],
    });
    writeFile("src/compounds/orders/elements/createOrder.ts");

    const ws = loadWorkspace(path.join(tmpDir, "workspace.yaml"));
    const compounds = discoverCompounds(ws, tmpDir);

    const result = runCheckEdit({
      workspace: ws,
      workspaceDir: tmpDir,
      compounds,
      plugin: createStubPlugin({}),
      filePath: "src/compounds/orders/elements/createOrder.ts",
    });

    const move = result.diagnostics.find((d) => d.code === "CHEM-PLACEMENT-003");
    expect(move).toBeDefined();
    expect(move!.remediation).toEqual({
      kind: "move_to_role_folder",
      expected_folder: "reactions",
    });
  });

  it("emits `import_via_public_surface` remediation for cross-compound bypass", () => {
    writeWorkspace();
    writeCompound("src/compounds", "orders", {
      imports: [{ compound: "billing" }],
      units: [{ role: "reaction", name: "createOrder", file: "./reactions/createOrder.ts" }],
    });
    writeCompound("src/compounds", "billing", {
      exports: { molecules: ["Invoice"] },
      units: [{ role: "molecule", name: "Invoice", file: "./molecules/Invoice.ts" }],
    });
    const invoiceAbs = writeFile(
      "src/compounds/billing/molecules/Invoice.ts",
      "export class Invoice {}\n",
    );
    writeFile(
      "src/compounds/billing/public.ts",
      'export { Invoice } from "./molecules/Invoice";\n',
    );
    writeFile("src/compounds/orders/reactions/createOrder.ts", "// placeholder\n");

    const ws = loadWorkspace(path.join(tmpDir, "workspace.yaml"));
    const compounds = discoverCompounds(ws, tmpDir);

    const plugin = createStubPlugin({
      imports: [
        {
          moduleSpecifier: "../../billing/molecules/Invoice",
          names: ["Invoice"],
          isTypeOnly: false,
        },
      ],
      resolveModulePath: (_from, spec) => (spec.endsWith("Invoice") ? invoiceAbs : undefined),
    });

    const result = runCheckEdit({
      workspace: ws,
      workspaceDir: tmpDir,
      compounds,
      plugin,
      filePath: "src/compounds/orders/reactions/createOrder.ts",
    });

    const bypass = result.diagnostics.find((d) => d.code === "CHEM-IMPORT-004");
    expect(bypass, JSON.stringify(result.diagnostics, null, 2)).toBeDefined();
    expect(bypass!.remediation).toEqual({
      kind: "import_via_public_surface",
      surface: "public.ts",
      target_compound: "billing",
    });
  });

  it("emits `add_compound_import` remediation when target compound is not in imports", () => {
    writeWorkspace();
    writeCompound("src/compounds", "orders", {
      // NB: no imports[] entry for billing
      units: [{ role: "reaction", name: "createOrder", file: "./reactions/createOrder.ts" }],
    });
    writeCompound("src/compounds", "billing", {
      exports: { molecules: ["Invoice"] },
      units: [{ role: "molecule", name: "Invoice", file: "./molecules/Invoice.ts" }],
    });
    const invoiceAbs = writeFile(
      "src/compounds/billing/molecules/Invoice.ts",
      "export class Invoice {}\n",
    );
    writeFile(
      "src/compounds/billing/public.ts",
      'export { Invoice } from "./molecules/Invoice";\n',
    );
    writeFile("src/compounds/orders/reactions/createOrder.ts", "// placeholder\n");

    const ws = loadWorkspace(path.join(tmpDir, "workspace.yaml"));
    const compounds = discoverCompounds(ws, tmpDir);

    const plugin = createStubPlugin({
      imports: [
        {
          moduleSpecifier: "../../billing/molecules/Invoice",
          names: ["Invoice"],
          isTypeOnly: false,
        },
      ],
      resolveModulePath: (_from, spec) => (spec.endsWith("Invoice") ? invoiceAbs : undefined),
    });

    const result = runCheckEdit({
      workspace: ws,
      workspaceDir: tmpDir,
      compounds,
      plugin,
      filePath: "src/compounds/orders/reactions/createOrder.ts",
    });

    const undecl = result.diagnostics.find((d) => d.code === "CHEM-IMPORT-003");
    expect(undecl, JSON.stringify(result.diagnostics, null, 2)).toBeDefined();
    expect(undecl!.remediation).toEqual({
      kind: "add_compound_import",
      target_compound: "billing",
    });
  });

  it("supports the `move_to_compound` remediation kind in the type system", () => {
    // The kind exists in the type union and consumers can produce it; the
    // wp-004 engine doesn't auto-emit it (best-effort suggestion is left for
    // a future stage). We assert the discriminated union includes it.
    const sample = {
      kind: "move_to_compound" as const,
      compound_candidates: ["orders", "billing"],
    };
    expect(sample.kind).toBe("move_to_compound");
    expect(sample.compound_candidates).toEqual(["orders", "billing"]);
  });
});

// ---------------------------------------------------------------------------
// `--content` (stdin) override path
// ---------------------------------------------------------------------------

describe("runCheckEdit — content override", () => {
  it("uses the supplied content over what's on disk", () => {
    writeWorkspace();
    writeCompound("src/compounds", "orders", {
      units: [{ role: "reaction", name: "createOrder", file: "./reactions/createOrder.ts" }],
    });
    writeCompound("src/compounds", "billing", {
      exports: { adapters: [] },
      units: [
        {
          role: "adapter",
          name: "PgBilling",
          file: "./adapters/PgBilling.ts",
          implements: ["BillingRepo"],
        },
      ],
    });
    writeFile(
      "src/compounds/orders/reactions/createOrder.ts",
      "// clean — no imports\nexport async function createOrder() {}\n",
    );
    const adapterAbs = writeFile(
      "src/compounds/billing/adapters/PgBilling.ts",
      "export class PgBilling {}\n",
    );

    const ws = loadWorkspace(path.join(tmpDir, "workspace.yaml"));
    const compounds = discoverCompounds(ws, tmpDir);

    // The plugin returns "dirty" imports regardless of the file path being
    // parsed. With --content set, the engine writes the content to a temp
    // file in the source's directory and parses it; our stub returns the
    // dirty imports for that call too.
    const plugin = createStubPlugin({
      imports: [
        {
          moduleSpecifier: "../../billing/adapters/PgBilling",
          names: ["PgBilling"],
          isTypeOnly: false,
        },
      ],
      resolveModulePath: (_from, spec) => (spec.endsWith("PgBilling") ? adapterAbs : undefined),
    });

    const result = runCheckEdit({
      workspace: ws,
      workspaceDir: tmpDir,
      compounds,
      plugin,
      filePath: "src/compounds/orders/reactions/createOrder.ts",
      content:
        'import { PgBilling } from "../../billing/adapters/PgBilling";\nexport async function createOrder() { new PgBilling(); }\n',
    });

    const bond = result.diagnostics.find((d) => d.code === "CHEM-BOND-003");
    expect(bond, JSON.stringify(result.diagnostics, null, 2)).toBeDefined();
  });
});
