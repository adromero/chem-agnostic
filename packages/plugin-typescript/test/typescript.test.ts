import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { typescriptPlugin } from "../src/index.js";
import { parseImports, parseImportsBatch, resolveModulePath } from "../src/parser.js";
import {
  generateUnitStub,
  generatePublicSurface,
  generateAssayStub,
  formatImportStatement,
  formatRelativeImport,
  inferUnits,
  inferImplements,
  generateClaudeMd,
} from "../src/generator.js";

import type {
  UnitDeclaration,
  ResolvedImport,
  LoadedCompound,
  Workspace,
  AssayDeclaration,
} from "@chemag/core/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-ts-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTemp(relPath: string, content: string): string {
  const abs = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
  return abs;
}

// ---------------------------------------------------------------------------
// Unit stub generation — all 6 roles
// ---------------------------------------------------------------------------

describe("generateUnitStub", () => {
  const noImports: ResolvedImport[] = [];

  it("generates element stub", () => {
    const unit: UnitDeclaration = { role: "element", name: "UserId", file: "./elements/UserId.ts" };
    const code = generateUnitStub(unit, noImports);
    expect(code).toContain("export class UserId");
    expect(code).toContain("readonly value: string");
  });

  it("generates molecule stub", () => {
    const unit: UnitDeclaration = { role: "molecule", name: "Order", file: "./molecules/Order.ts" };
    const code = generateUnitStub(unit, noImports);
    expect(code).toContain("export class Order");
    expect(code).toContain("constructor()");
  });

  it("generates reaction stub", () => {
    const unit: UnitDeclaration = {
      role: "reaction",
      name: "createOrder",
      file: "./reactions/createOrder.ts",
    };
    const code = generateUnitStub(unit, noImports);
    expect(code).toContain("export async function createOrder");
    expect(code).toContain("Promise<void>");
  });

  it("generates interface stub", () => {
    const unit: UnitDeclaration = {
      role: "interface",
      name: "OrderRepo",
      file: "./interfaces/OrderRepo.ts",
    };
    const code = generateUnitStub(unit, noImports);
    expect(code).toContain("export interface OrderRepo");
  });

  it("generates adapter stub with implements", () => {
    const unit: UnitDeclaration = {
      role: "adapter",
      name: "PgOrderRepo",
      file: "./adapters/PgOrderRepo.ts",
      implements: ["OrderRepo"],
    };
    const code = generateUnitStub(unit, noImports);
    expect(code).toContain("export class PgOrderRepo implements OrderRepo");
  });

  it("generates adapter stub without implements", () => {
    const unit: UnitDeclaration = {
      role: "adapter",
      name: "PgOrderRepo",
      file: "./adapters/PgOrderRepo.ts",
    };
    const code = generateUnitStub(unit, noImports);
    expect(code).toContain("export class PgOrderRepo");
    expect(code).not.toContain("implements");
  });

  it("generates buffer stub", () => {
    const unit: UnitDeclaration = {
      role: "buffer",
      name: "authGuard",
      file: "./buffers/authGuard.ts",
    };
    const code = generateUnitStub(unit, noImports);
    expect(code).toContain("export function authGuard");
    expect(code).toContain("next: () => Promise<void>");
    expect(code).toContain("return next()");
  });

  it("generates fallback for unknown role", () => {
    const unit: UnitDeclaration = { role: "mystery", name: "Foo", file: "./mystery/Foo.ts" };
    const code = generateUnitStub(unit, noImports);
    expect(code).toContain("TODO");
    expect(code).toContain("Foo");
  });

  it("includes imports when provided", () => {
    const unit: UnitDeclaration = {
      role: "reaction",
      name: "doWork",
      file: "./reactions/doWork.ts",
    };
    const imports: ResolvedImport[] = [
      {
        fromCompound: "../interfaces/Logger",
        fromUnit: "Logger",
        names: ["Logger"],
        isTypeOnly: true,
      },
    ];
    const code = generateUnitStub(unit, imports);
    expect(code).toContain("import type { Logger }");
  });
});

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

describe("parseImports", () => {
  it("parses named imports", () => {
    const fp = writeTemp("named.ts", `import { Foo, Bar } from "./foo";\n`);
    const result = parseImports(fp);
    expect(result).toHaveLength(1);
    expect(result[0].names).toEqual(["Foo", "Bar"]);
    expect(result[0].moduleSpecifier).toBe("./foo");
    expect(result[0].isTypeOnly).toBe(false);
  });

  it("parses default imports", () => {
    const fp = writeTemp("default.ts", `import Baz from "./baz";\n`);
    const result = parseImports(fp);
    expect(result).toHaveLength(1);
    expect(result[0].names).toContain("Baz");
  });

  it("parses type-only imports", () => {
    const fp = writeTemp("typeonly.ts", `import type { Qux } from "./qux";\n`);
    const result = parseImports(fp);
    expect(result).toHaveLength(1);
    expect(result[0].isTypeOnly).toBe(true);
    expect(result[0].names).toEqual(["Qux"]);
  });

  it("parses re-exports as imports", () => {
    const fp = writeTemp("reexport.ts", `export { Zed } from "./zed";\n`);
    const result = parseImports(fp);
    expect(result).toHaveLength(1);
    expect(result[0].names).toEqual(["Zed"]);
    expect(result[0].moduleSpecifier).toBe("./zed");
  });

  it("parses namespace imports", () => {
    const fp = writeTemp("ns.ts", `import * as utils from "./utils";\n`);
    const result = parseImports(fp);
    expect(result).toHaveLength(1);
    expect(result[0].names).toEqual(["* as utils"]);
  });

  it("returns empty for missing file", () => {
    const result = parseImports(path.join(tmpDir, "nonexistent.ts"));
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseImportsBatch
// ---------------------------------------------------------------------------

describe("parseImportsBatch", () => {
  it("parses multiple files in one call", () => {
    const fp1 = writeTemp("a.ts", `import { A } from "./aa";\n`);
    const fp2 = writeTemp("b.ts", `import { B } from "./bb";\nimport { C } from "./cc";\n`);
    const result = parseImportsBatch([fp1, fp2]);

    expect(result.size).toBe(2);
    expect(result.get(fp1)!).toHaveLength(1);
    expect(result.get(fp2)!).toHaveLength(2);
  });

  it("returns empty array for missing files", () => {
    const missing = path.join(tmpDir, "ghost.ts");
    const fp = writeTemp("real.ts", `import { X } from "./x";\n`);
    const result = parseImportsBatch([missing, fp]);

    expect(result.get(missing)).toEqual([]);
    expect(result.get(fp)!).toHaveLength(1);
  });

  it("returns empty map for empty input", () => {
    const result = parseImportsBatch([]);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveModulePath
// ---------------------------------------------------------------------------

describe("resolveModulePath", () => {
  it("resolves .ts extension", () => {
    const target = writeTemp("lib/foo.ts", "export const x = 1;\n");
    const from = writeTemp("src/main.ts", "");
    const resolved = resolveModulePath(from, "../lib/foo");
    expect(resolved).toBe(target);
  });

  it("resolves .tsx extension", () => {
    const target = writeTemp("lib/comp.tsx", "export default function Comp() {}\n");
    const from = writeTemp("src/main.ts", "");
    const resolved = resolveModulePath(from, "../lib/comp");
    expect(resolved).toBe(target);
  });

  it("resolves index.ts", () => {
    const target = writeTemp("lib/utils/index.ts", "export const y = 2;\n");
    const from = writeTemp("src/main.ts", "");
    const resolved = resolveModulePath(from, "../lib/utils");
    expect(resolved).toBe(target);
  });

  it("returns undefined for non-existent module", () => {
    const from = writeTemp("src/main.ts", "");
    const resolved = resolveModulePath(from, "../lib/nope");
    expect(resolved).toBeUndefined();
  });

  it("returns undefined for bare/package imports", () => {
    const from = writeTemp("src/main.ts", "");
    const resolved = resolveModulePath(from, "vitest");
    expect(resolved).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Public surface barrel
// ---------------------------------------------------------------------------

describe("generatePublicSurface", () => {
  it("generates barrel with export type for interfaces", () => {
    const compound: LoadedCompound = {
      dir: "/fake/compounds/orders",
      manifest: {
        compound: "orders",
        exports: {
          elements: ["OrderId"],
          interfaces: ["OrderRepo"],
          reactions: ["createOrder"],
        },
        units: [
          { role: "element", name: "OrderId", file: "./elements/OrderId.ts" },
          { role: "interface", name: "OrderRepo", file: "./interfaces/OrderRepo.ts" },
          { role: "reaction", name: "createOrder", file: "./reactions/createOrder.ts" },
        ],
      },
    };
    const workspace: Workspace = {
      workspace: "test",
      language: "typescript",
      roles: {},
      bonds: {},
      paths: { compounds: "compounds" },
    };

    const result = generatePublicSurface(compound, workspace);

    expect(result).toContain(`export { OrderId } from "./elements/OrderId";`);
    expect(result).toContain(`export type { OrderRepo } from "./interfaces/OrderRepo";`);
    expect(result).toContain(`export { createOrder } from "./reactions/createOrder";`);
  });

  it("returns empty string when no exports", () => {
    const compound: LoadedCompound = {
      dir: "/fake",
      manifest: { compound: "empty" },
    };
    const workspace: Workspace = {
      workspace: "test",
      language: "typescript",
      roles: {},
      bonds: {},
      paths: { compounds: "compounds" },
    };
    const result = generatePublicSurface(compound, workspace);
    expect(result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// formatImportStatement
// ---------------------------------------------------------------------------

describe("formatImportStatement", () => {
  it("formats a value import", () => {
    const stmt = formatImportStatement("Foo", "./foo", false);
    expect(stmt).toBe(`import { Foo } from "./foo";`);
  });

  it("formats a type-only import", () => {
    const stmt = formatImportStatement("Bar", "./bar", true);
    expect(stmt).toBe(`import type { Bar } from "./bar";`);
  });

  it("formats multiple names", () => {
    const stmt = formatImportStatement("A, B", "./ab", false);
    expect(stmt).toBe(`import { A, B } from "./ab";`);
  });
});

// ---------------------------------------------------------------------------
// inferImplements
// ---------------------------------------------------------------------------

describe("inferImplements", () => {
  it("detects single implements clause", () => {
    const fp = writeTemp("adapter.ts", "export class PgRepo implements OrderRepo {\n}\n");
    const result = inferImplements(fp);
    expect(result).toEqual(["OrderRepo"]);
  });

  it("detects multiple implements", () => {
    const fp = writeTemp("multi.ts", "export class Multi implements Foo, Bar {\n}\n");
    const result = inferImplements(fp);
    expect(result).toEqual(["Foo", "Bar"]);
  });

  it("returns empty for no implements", () => {
    const fp = writeTemp("plain.ts", "export class Plain {\n}\n");
    const result = inferImplements(fp);
    expect(result).toEqual([]);
  });

  it("returns empty for non-existent file", () => {
    const result = inferImplements(path.join(tmpDir, "nope.ts"));
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// inferUnits
// ---------------------------------------------------------------------------

describe("inferUnits", () => {
  it("infers units from role directory", () => {
    writeTemp(
      "compound/elements/UserId.ts",
      "export class UserId { constructor(readonly value: string) {} }\n",
    );
    writeTemp(
      "compound/elements/Email.ts",
      "export class Email { constructor(readonly value: string) {} }\n",
    );

    const units = inferUnits(path.join(tmpDir, "compound"), "elements", "element");
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.name).sort()).toEqual(["Email", "UserId"]);
    expect(units[0].role).toBe("element");
  });

  it("skips .test.ts and .spec.ts and .d.ts files", () => {
    writeTemp("compound/reactions/doWork.ts", "export async function doWork() {}\n");
    writeTemp("compound/reactions/doWork.test.ts", `test("", () => {});\n`);
    writeTemp("compound/reactions/doWork.spec.ts", `test("", () => {});\n`);
    writeTemp("compound/reactions/types.d.ts", `declare module "x" {}\n`);

    const units = inferUnits(path.join(tmpDir, "compound"), "reactions", "reaction");
    expect(units).toHaveLength(1);
    expect(units[0].name).toBe("doWork");
  });

  it("returns empty for non-existent directory", () => {
    const units = inferUnits(path.join(tmpDir, "nope"), "elements", "element");
    expect(units).toEqual([]);
  });

  it("infers implements for adapter role", () => {
    writeTemp("compound/adapters/PgRepo.ts", "export class PgRepo implements OrderRepo {\n}\n");
    const units = inferUnits(path.join(tmpDir, "compound"), "adapters", "adapter");
    expect(units).toHaveLength(1);
    expect(units[0].implements).toBe("OrderRepo");
  });
});

// ---------------------------------------------------------------------------
// CLAUDE.md generation
// ---------------------------------------------------------------------------

describe("generateClaudeMd (TypeScript-specific section only)", () => {
  it("emits the TypeScript cross-compound import section", () => {
    const md = generateClaudeMd("my-project");

    // Plugin output now contains only the language-specific section.
    // The core template (in @chemag/core) supplies the title, roles, bonds, etc.
    expect(md).toContain("## Cross-Compound Imports");
    expect(md).toContain("public.ts");
  });

  it("output is unaffected by workspace name (language section is name-agnostic)", () => {
    const a = generateClaudeMd("foo");
    const b = generateClaudeMd("bar");
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// index.ts plugin interface
// ---------------------------------------------------------------------------

describe("typescriptPlugin (index.ts)", () => {
  it("has correct name and extensions", () => {
    expect(typescriptPlugin.name).toBe("typescript");
    expect(typescriptPlugin.fileExtensions).toEqual([".ts", ".tsx"]);
  });

  it("has correct defaults", () => {
    expect(typescriptPlugin.defaults.publicSurface).toBe("public.ts");
    expect(typescriptPlugin.defaults.testFilePattern).toEqual(/\.test\.ts$/);
    expect(typescriptPlugin.defaults.testFrameworkImport).toBe("vitest");
  });

  it("isSourceFile accepts .ts files", () => {
    expect(typescriptPlugin.isSourceFile("Foo.ts")).toBe(true);
    expect(typescriptPlugin.isSourceFile("Bar.tsx")).toBe(true);
  });

  it("isSourceFile rejects test/spec/d.ts files", () => {
    expect(typescriptPlugin.isSourceFile("Foo.test.ts")).toBe(false);
    expect(typescriptPlugin.isSourceFile("Foo.spec.ts")).toBe(false);
    expect(typescriptPlugin.isSourceFile("Foo.d.ts")).toBe(false);
    expect(typescriptPlugin.isSourceFile("Foo.test.tsx")).toBe(false);
    expect(typescriptPlugin.isSourceFile("Foo.spec.tsx")).toBe(false);
  });

  it("isSourceFile rejects non-TS files", () => {
    expect(typescriptPlugin.isSourceFile("foo.js")).toBe(false);
    expect(typescriptPlugin.isSourceFile("foo.py")).toBe(false);
    expect(typescriptPlugin.isSourceFile("foo.css")).toBe(false);
  });

  it("unitFilePath returns PascalName.ts in role folder", () => {
    expect(typescriptPlugin.unitFilePath("element", "UserId", "elements")).toBe(
      path.join("elements", "UserId.ts"),
    );
  });

  it("formatRelativeImport strips .ts extension", () => {
    const result = typescriptPlugin.formatRelativeImport(
      "/project/compounds/orders/reactions",
      "/project/compounds/orders/elements/OrderId.ts",
    );
    expect(result).toBe("../elements/OrderId");
    expect(result).not.toContain(".ts");
  });

  it("formatRelativeImport adds ./ prefix for same-directory imports", () => {
    const result = typescriptPlugin.formatRelativeImport(
      "/project/compounds/orders/elements",
      "/project/compounds/orders/elements/OrderId.ts",
    );
    expect(result).toBe("./OrderId");
  });

  it("delegates parseImports correctly", () => {
    const fp = writeTemp("delegate.ts", `import { X } from "./x";\n`);
    const result = typescriptPlugin.parseImports(fp);
    expect(result).toHaveLength(1);
    expect(result[0].names).toEqual(["X"]);
  });

  it("delegates generateClaudeMd correctly", () => {
    const md = typescriptPlugin.generateClaudeMd("delegate-test");
    // The plugin emits the language-specific section only — the title and
    // shared sections are added by @chemag/core/template-claude-md.
    expect(md).toContain("## Cross-Compound Imports");
    expect(md).toContain("public.ts");
  });
});

// ---------------------------------------------------------------------------
// generateAssayStub
// ---------------------------------------------------------------------------

describe("generateAssayStub", () => {
  it("generates test stub with imports for subjects", () => {
    const assay: AssayDeclaration = {
      name: "orders.test",
      file: "./assays/orders.test.ts",
      subjects: ["createOrder"],
    };
    const compound: LoadedCompound = {
      dir: "/fake/compounds/orders",
      manifest: {
        compound: "orders",
        units: [{ role: "reaction", name: "createOrder", file: "./reactions/createOrder.ts" }],
      },
    };
    const result = generateAssayStub(assay, compound);
    expect(result).toContain("import { createOrder }");
    expect(result).toContain(`describe("createOrder"`);
    expect(result).toContain("it.todo");
  });

  it("generates stub without imports when no subjects", () => {
    const assay: AssayDeclaration = {
      name: "misc.test",
      file: "./assays/misc.test.ts",
    };
    const compound: LoadedCompound = {
      dir: "/fake/compounds/misc",
      manifest: { compound: "misc" },
    };
    const result = generateAssayStub(assay, compound);
    expect(result).not.toContain("import");
    expect(result).toContain(`describe("misc.test"`);
  });
});
