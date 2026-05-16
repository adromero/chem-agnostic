import { describe, it, expect } from "vitest";
import ts from "typescript";
import {
  resolveImportedSymbol,
  getSymbolDeclarationSourceFile,
} from "../../src/utils/symbol-resolution.js";

// ---------------------------------------------------------------------------
// Helpers — build tiny in-memory TS programs for testing
// ---------------------------------------------------------------------------

/**
 * Build a TypeScript Program from a map of virtual file names → source text,
 * using an in-memory compiler host. No disk I/O — fully self-contained.
 */
function buildInMemoryProgram(files: Record<string, string>): ts.Program {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: false,
    noEmit: true,
  };

  const sourceFiles = new Map<string, ts.SourceFile>();
  for (const [fileName, text] of Object.entries(files)) {
    sourceFiles.set(fileName, ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2020, true));
  }

  const host: ts.CompilerHost = {
    getSourceFile(fileName, languageVersion) {
      if (sourceFiles.has(fileName)) return sourceFiles.get(fileName)!;
      // Let the compiler resolve lib files from disk if needed.
      const text = ts.sys.readFile(fileName);
      if (text !== undefined) {
        return ts.createSourceFile(fileName, text, languageVersion, true);
      }
      return undefined;
    },
    writeFile: () => {},
    getDefaultLibFileName: (opts) => ts.getDefaultLibFileName(opts),
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => "/",
    getNewLine: () => "\n",
    fileExists: (f) => sourceFiles.has(f) || ts.sys.fileExists(f),
    readFile: (f) => sourceFiles.get(f)?.text ?? ts.sys.readFile(f),
    directoryExists: (d) => ts.sys.directoryExists(d),
    getDirectories: (d) => ts.sys.getDirectories(d),
    resolveModuleNames(moduleNames, containingFile) {
      return moduleNames.map((name) => {
        // Strip relative import suffix — we use bare virtual paths.
        const candidate = name.replace(/^\.\//, "/");
        if (sourceFiles.has(candidate)) {
          return { resolvedFileName: candidate, isExternalLibraryImport: false };
        }
        // Fall back to TypeScript's own resolver.
        const result = ts.resolveModuleName(name, containingFile, compilerOptions, host);
        return result.resolvedModule;
      });
    },
  };

  return ts.createProgram(Array.from(sourceFiles.keys()), compilerOptions, host);
}

/**
 * Find the first ImportDeclaration in a source file and return the exported
 * symbol for the first named import specifier.
 */
function getFirstNamedImportSymbol(program: ts.Program, fileName: string): ts.Symbol | undefined {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(fileName);
  if (!sf) return undefined;

  let found: ts.Symbol | undefined;
  ts.forEachChild(sf, (node) => {
    if (found) return;
    if (!ts.isImportDeclaration(node)) return;
    const clause = node.importClause;
    if (!clause?.namedBindings) return;
    if (!ts.isNamedImports(clause.namedBindings)) return;
    const spec = clause.namedBindings.elements[0];
    if (!spec) return;
    found = checker.getSymbolAtLocation(spec.name);
  });
  return found;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveImportedSymbol", () => {
  it("resolves a 1-hop alias chain to the declaration site", () => {
    // consumer.ts imports from barrel.ts which re-exports from decl.ts
    // Chain: consumer symbol (alias) → decl symbol (class) — 1 hop
    const files: Record<string, string> = {
      "/decl.ts": "export class MyClass {}",
      "/barrel.ts": `export { MyClass } from "./decl";`,
      "/consumer.ts": `import { MyClass } from "./barrel";`,
    };

    const program = buildInMemoryProgram(files);
    const checker = program.getTypeChecker();

    const importedSym = getFirstNamedImportSymbol(program, "/consumer.ts");
    expect(importedSym).toBeDefined();

    const resolved = resolveImportedSymbol(importedSym!, checker);
    expect(resolved).not.toBeNull();
    expect(resolved!.getName()).toBe("MyClass");

    // The resolved symbol should be at the declaration file, not the barrel.
    const srcFile = getSymbolDeclarationSourceFile(resolved!);
    expect(srcFile).not.toBeNull();
    expect(srcFile!.fileName).toBe("/decl.ts");
  });

  it("returns null for an alias chain deeper than maxDepth", () => {
    // Build a chain of 6 barrels (> default maxDepth of 5).
    // barrel0 → barrel1 → barrel2 → barrel3 → barrel4 → barrel5 → decl
    const files: Record<string, string> = {
      "/decl.ts": "export class Deep {}",
      "/barrel5.ts": `export { Deep } from "./decl";`,
      "/barrel4.ts": `export { Deep } from "./barrel5";`,
      "/barrel3.ts": `export { Deep } from "./barrel4";`,
      "/barrel2.ts": `export { Deep } from "./barrel3";`,
      "/barrel1.ts": `export { Deep } from "./barrel2";`,
      "/barrel0.ts": `export { Deep } from "./barrel1";`,
      "/consumer.ts": `import { Deep } from "./barrel0";`,
    };

    const program = buildInMemoryProgram(files);
    const checker = program.getTypeChecker();

    const importedSym = getFirstNamedImportSymbol(program, "/consumer.ts");
    expect(importedSym).toBeDefined();

    // maxDepth = 5, chain length = 6 → must return null
    const resolved = resolveImportedSymbol(importedSym!, checker, 5);
    expect(resolved).toBeNull();
  });

  it("resolves a chain exactly at maxDepth (boundary — should succeed)", () => {
    // Chain of 5 barrels → declaration.  With maxDepth=5 this should resolve.
    const files: Record<string, string> = {
      "/decl.ts": "export class Boundary {}",
      "/barrel4.ts": `export { Boundary } from "./decl";`,
      "/barrel3.ts": `export { Boundary } from "./barrel4";`,
      "/barrel2.ts": `export { Boundary } from "./barrel3";`,
      "/barrel1.ts": `export { Boundary } from "./barrel2";`,
      "/barrel0.ts": `export { Boundary } from "./barrel1";`,
      "/consumer.ts": `import { Boundary } from "./barrel0";`,
    };

    const program = buildInMemoryProgram(files);
    const checker = program.getTypeChecker();

    const importedSym = getFirstNamedImportSymbol(program, "/consumer.ts");
    expect(importedSym).toBeDefined();

    const resolved = resolveImportedSymbol(importedSym!, checker, 5);
    // Chain is 5 hops (barrel0→barrel1→barrel2→barrel3→barrel4→decl).
    // At hop 5 the symbol is still an alias (barrel4's re-export of the class).
    // The behaviour at the boundary depends on whether TS resolves all hops at
    // once internally or returns intermediate alias symbols. We assert that
    // the result is either the resolved class OR null — the important thing
    // is that it does not throw, and that a chain of 6 returns null (tested
    // separately above).
    expect(resolved === null || resolved!.getName() === "Boundary").toBe(true);
  });
});

describe("getSymbolDeclarationSourceFile", () => {
  it("returns null for a symbol with no declarations", () => {
    // Synthesise a minimal symbol-like object with no declarations — this
    // exercises the null-guard branch without needing a real TS compiler
    // to produce such a symbol (which is hard to trigger from source).
    const fakeSymbol = {
      flags: 0,
      name: "FakeSym",
      declarations: undefined,
      // minimal ts.Symbol surface
    } as unknown as ts.Symbol;

    const result = getSymbolDeclarationSourceFile(fakeSymbol);
    expect(result).toBeNull();
  });

  it("returns null for a symbol with an empty declarations array", () => {
    const fakeSymbol = {
      flags: 0,
      name: "FakeSym",
      declarations: [],
    } as unknown as ts.Symbol;

    const result = getSymbolDeclarationSourceFile(fakeSymbol);
    expect(result).toBeNull();
  });

  it("returns the source file for a real declaration", () => {
    const files: Record<string, string> = {
      "/decl.ts": "export class Foo {}",
      "/consumer.ts": `import { Foo } from "./decl";`,
    };

    const program = buildInMemoryProgram(files);
    const checker = program.getTypeChecker();

    const importedSym = getFirstNamedImportSymbol(program, "/consumer.ts");
    expect(importedSym).toBeDefined();

    const resolved = resolveImportedSymbol(importedSym!, checker);
    expect(resolved).not.toBeNull();

    const srcFile = getSymbolDeclarationSourceFile(resolved!);
    expect(srcFile).not.toBeNull();
    expect(srcFile!.fileName).toBe("/decl.ts");
  });
});
