import * as fs from "node:fs";
import * as path from "node:path";
import { Project, type SourceFile } from "ts-morph";
import type { ParsedImport } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse import statements from multiple files in a single ts-morph Project.
 * Returns a Map from file path to its parsed imports.
 * For missing/unreadable files, returns an empty array.
 */
export function parseImportsBatch(
  filePaths: string[],
): Map<string, ParsedImport[]> {
  const result = new Map<string, ParsedImport[]>();

  if (filePaths.length === 0) return result;

  const project = new Project({
    compilerOptions: { allowJs: true, noEmit: true },
    skipAddingFilesFromTsConfig: true,
  });

  for (const fp of filePaths) {
    try {
      project.addSourceFileAtPath(fp);
    } catch {
      // File may not exist — will get empty array
    }
  }

  for (const fp of filePaths) {
    const sourceFile = project.getSourceFile(fp);
    if (!sourceFile) {
      result.set(fp, []);
      continue;
    }
    result.set(fp, extractImports(sourceFile));
  }

  return result;
}

/**
 * Parse import statements from a single source file.
 * Convenience wrapper around parseImportsBatch.
 */
export function parseImports(filePath: string): ParsedImport[] {
  const batch = parseImportsBatch([filePath]);
  return batch.get(filePath) ?? [];
}

/**
 * Resolve a module specifier to an absolute file path.
 * Checks filesystem for .ts, .tsx, index.ts candidates.
 * Returns the first that exists, or undefined.
 */
export function resolveModulePath(
  fromFile: string,
  moduleSpec: string,
): string | undefined {
  // Skip bare/package imports (node_modules)
  if (!moduleSpec.startsWith(".") && !moduleSpec.startsWith("/")) {
    return undefined;
  }

  const dir = path.dirname(fromFile);
  const base = path.resolve(dir, moduleSpec);

  const candidates = [
    base,
    base + ".ts",
    base + ".tsx",
    path.join(base, "index.ts"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return c;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractImports(sourceFile: SourceFile): ParsedImport[] {
  const imports: ParsedImport[] = [];

  for (const decl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    const isTypeOnly = decl.isTypeOnly();

    const names: string[] = [];

    // Default import
    const defaultImport = decl.getDefaultImport();
    if (defaultImport) {
      names.push(defaultImport.getText());
    }

    // Named imports
    for (const named of decl.getNamedImports()) {
      names.push(named.getName());
    }

    // Namespace import
    const nsImport = decl.getNamespaceImport();
    if (nsImport) {
      names.push(`* as ${nsImport.getText()}`);
    }

    imports.push({ moduleSpecifier, names, isTypeOnly });
  }

  // Re-exports (export { X } from "./foo")
  for (const exportDecl of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifier) continue; // local re-export, no module

    const isTypeOnly = exportDecl.isTypeOnly();
    const names: string[] = [];

    for (const named of exportDecl.getNamedExports()) {
      names.push(named.getName());
    }

    if (names.length > 0) {
      imports.push({ moduleSpecifier, names, isTypeOnly });
    }
  }

  return imports;
}
