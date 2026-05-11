import * as path from "node:path";
import type { LanguagePlugin } from "@chemag/core/plugin-interface";
import type {
  AssayDeclaration,
  FunctionDeclarationSite,
  InferredUnit,
  LoadedCompound,
  NewExpressionSite,
  ParsedImport,
  ResolvedImport,
  UnitDeclaration,
  Workspace,
} from "@chemag/core/types";
import {
  parseImportsBatch as doParseBatch,
  parseImports as doParseImports,
  resolveModulePath as doResolve,
  scanFunctionDeclarationsBatch as doScanFunctionDecls,
  scanNewExpressionsBatch as doScanNewExprs,
} from "./parser.js";
import {
  generateUnitStub as doUnitStub,
  generatePublicSurface as doPublicSurface,
  generateAssayStub as doAssayStub,
  formatImportStatement as doFormatImport,
  formatRelativeImport as doFormatRelative,
  inferUnits as doInferUnits,
  inferImplements as doInferImplements,
  generateClaudeMd as doClaudeMd,
} from "./generator.js";

export const typescriptPlugin: LanguagePlugin = {
  name: "typescript",
  fileExtensions: [".ts", ".tsx"],
  defaults: {
    publicSurface: "public.ts",
    testFilePattern: /\.test\.ts$/,
    testFrameworkImport: "vitest",
  },

  parseImportsBatch(filePaths: string[]): Map<string, ParsedImport[]> {
    return doParseBatch(filePaths);
  },

  parseImports(filePath: string): ParsedImport[] {
    return doParseImports(filePath);
  },

  scanNewExpressions(filePaths: string[]): Map<string, NewExpressionSite[]> {
    return doScanNewExprs(filePaths);
  },

  scanFunctionDeclarations(filePaths: string[]): Map<string, FunctionDeclarationSite[]> {
    return doScanFunctionDecls(filePaths);
  },

  resolveModulePath(fromFile: string, moduleSpec: string): string | undefined {
    return doResolve(fromFile, moduleSpec);
  },

  generateUnitStub(unit: UnitDeclaration, imports: ResolvedImport[]): string {
    return doUnitStub(unit, imports);
  },

  generatePublicSurface(compound: LoadedCompound, workspace: Workspace): string {
    return doPublicSurface(compound, workspace);
  },

  generateAssayStub(assay: AssayDeclaration, compound: LoadedCompound): string {
    return doAssayStub(assay, compound);
  },

  unitFilePath(_role: string, name: string, roleFolder: string): string {
    return path.join(roleFolder, `${name}.ts`);
  },

  formatRelativeImport(fromDir: string, toFile: string): string {
    return doFormatRelative(fromDir, toFile);
  },

  formatImportStatement(from: string, to: string, isTypeOnly: boolean): string {
    return doFormatImport(from, to, isTypeOnly);
  },

  inferUnits(dir: string, roleFolder: string, role: string): InferredUnit[] {
    return doInferUnits(dir, roleFolder, role);
  },

  inferImplements(filePath: string): string[] {
    return doInferImplements(filePath);
  },

  isSourceFile(filename: string): boolean {
    const ext = path.extname(filename);
    if (ext !== ".ts" && ext !== ".tsx") return false;
    if (filename.endsWith(".test.ts") || filename.endsWith(".test.tsx")) return false;
    if (filename.endsWith(".spec.ts") || filename.endsWith(".spec.tsx")) return false;
    if (filename.endsWith(".d.ts")) return false;
    return true;
  },

  generateClaudeMd(workspaceName: string): string {
    return doClaudeMd(workspaceName);
  },
};
