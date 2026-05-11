import path from "node:path";
import type { LanguagePlugin } from "@chemag/core/plugin-interface";
import type {
  AssayDeclaration,
  InferredUnit,
  LoadedCompound,
  ParsedImport,
  ResolvedImport,
  UnitDeclaration,
  Workspace,
} from "@chemag/core/types";
import {
  parseImportsBatch as doParseBatch,
  parseImports as doParseImports,
  resolveModulePath as doResolveModule,
} from "./parser.js";
import {
  generateUnitStub as doGenerateUnitStub,
  generatePublicSurface as doGeneratePublicSurface,
  generateAssayStub as doGenerateAssayStub,
  formatImportStatement as doFormatImportStatement,
  inferUnits as doInferUnits,
  inferImplements as doInferImplements,
  generateClaudeMd as doGenerateClaudeMd,
  toSnakeCase,
} from "./generator.js";

// Note: `scanNewExpressions` (used by CHEM-PORT-004) is intentionally
// omitted — the Python plugin does not perform symbol-level resolution,
// so it cannot reliably map `Foo()` call sites back to a class declaration
// file. Core treats the absence of `scanNewExpressions` as "skip this
// sub-tree for CHEM-PORT-004" and emits no diagnostics.
export const pythonPlugin: LanguagePlugin = {
  name: "python",
  fileExtensions: [".py"],
  defaults: {
    publicSurface: "__init__.py",
    testFilePattern: /test_.*\.py$/,
    testFrameworkImport: "pytest",
  },

  parseImportsBatch(filePaths: string[]): Map<string, ParsedImport[]> {
    return doParseBatch(filePaths);
  },

  parseImports(filePath: string): ParsedImport[] {
    return doParseImports(filePath);
  },

  resolveModulePath(fromFile: string, moduleSpec: string): string | undefined {
    return doResolveModule(fromFile, moduleSpec);
  },

  generateUnitStub(unit: UnitDeclaration, imports: ResolvedImport[]): string {
    return doGenerateUnitStub(unit, imports);
  },

  generatePublicSurface(compound: LoadedCompound, workspace: Workspace): string {
    return doGeneratePublicSurface(compound, workspace);
  },

  generateAssayStub(assay: AssayDeclaration, compound: LoadedCompound): string {
    return doGenerateAssayStub(assay, compound);
  },

  unitFilePath(role: string, name: string, roleFolder: string): string {
    const snakeName = toSnakeCase(name);
    return path.join(roleFolder, `${snakeName}.py`);
  },

  formatRelativeImport(fromDir: string, toFile: string): string {
    const rel = path.relative(fromDir, toFile);
    // Convert file path to Python module path
    const modulePath = rel
      .replace(/\.py$/, "")
      .replace(/\/__init__$/, "")
      .split(path.sep)
      .join(".");
    return `.${modulePath}`;
  },

  formatImportStatement(from: string, to: string, isTypeOnly: boolean): string {
    return doFormatImportStatement(from, to, isTypeOnly);
  },

  inferUnits(dir: string, roleFolder: string, role: string): InferredUnit[] {
    return doInferUnits(dir, roleFolder, role);
  },

  inferImplements(filePath: string): string[] {
    return doInferImplements(filePath);
  },

  isSourceFile(filename: string): boolean {
    if (!filename.endsWith(".py")) return false;
    // Exclude __pycache__ contents
    if (filename.includes("__pycache__")) return false;
    // Exclude conftest.py
    if (path.basename(filename) === "conftest.py") return false;
    // Exclude stub files
    if (filename.endsWith(".pyi")) return false;
    // Exclude test files
    if (path.basename(filename).startsWith("test_")) return false;
    return true;
  },

  generateClaudeMd(workspaceName: string): string {
    return doGenerateClaudeMd(workspaceName);
  },
};
