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

export const goPlugin: LanguagePlugin = {
  name: "go",
  fileExtensions: [".go"],
  defaults: {
    publicSurface: "public.go",
    testFilePattern: /_test\.go$/,
    testFrameworkImport: "testing",
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

  unitFilePath(_role: string, name: string, roleFolder: string): string {
    const snake = toSnakeCase(name);
    return path.join(roleFolder, `${snake}.go`);
  },

  formatRelativeImport(_fromDir: string, toFile: string): string {
    // Go imports by package path, not by relative file location. Best we
    // can do at this layer is hand back the unaltered target so callers
    // (which generally pass already-resolved import paths) keep working.
    return toFile;
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
    if (!filename.endsWith(".go")) return false;
    if (filename.endsWith("_test.go")) return false;
    return true;
  },

  generateClaudeMd(workspaceName: string): string {
    return doGenerateClaudeMd(workspaceName);
  },
};
