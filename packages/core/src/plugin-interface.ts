import type {
  AssayDeclaration,
  InferredUnit,
  LoadedCompound,
  ParsedImport,
  ResolvedImport,
  UnitDeclaration,
  Workspace,
} from "./types.js";

/**
 * Language plugin interface for the Chem architecture analyzer.
 *
 * Each supported language (TypeScript, Python, etc.) implements this
 * interface to provide language-specific parsing, code generation,
 * and import resolution.
 */
export interface LanguagePlugin {
  /** Unique identifier for this language plugin (e.g. "typescript", "python"). */
  readonly name: string;

  /** File extensions this plugin handles (e.g. [".ts", ".tsx"]). */
  readonly fileExtensions: string[];

  /** Default values for language-specific conventions. */
  readonly defaults: {
    /** Filename of the public surface module (e.g. "public.ts"). */
    publicSurface: string;
    /** Pattern matching test files (e.g. /\.test\.ts$/). */
    testFilePattern: RegExp;
    /** Import path for the test framework (e.g. "vitest"). */
    testFrameworkImport: string;
  };

  /**
   * Parse import statements from multiple files in a single batch.
   * Returns a map from file path to its parsed imports.
   */
  parseImportsBatch(filePaths: string[]): Map<string, ParsedImport[]>;

  /**
   * Parse import statements from a single source file.
   */
  parseImports(filePath: string): ParsedImport[];

  /**
   * Resolve a module specifier to an absolute file path.
   * Returns undefined if the module cannot be resolved.
   */
  resolveModulePath(fromFile: string, moduleSpec: string): string | undefined;

  /**
   * Generate a stub source file for a unit declaration.
   */
  generateUnitStub(unit: UnitDeclaration, imports: ResolvedImport[]): string;

  /**
   * Generate the public surface module (re-exports) for a compound.
   */
  generatePublicSurface(compound: LoadedCompound, workspace: Workspace): string;

  /**
   * Generate a stub test (assay) file for a compound.
   */
  generateAssayStub(assay: AssayDeclaration, compound: LoadedCompound): string;

  /**
   * Compute the file path for a unit given its role, name, and role folder.
   */
  unitFilePath(role: string, name: string, roleFolder: string): string;

  /**
   * Format a relative import path between two files.
   */
  formatRelativeImport(fromDir: string, toFile: string): string;

  /**
   * Format a complete import statement string.
   */
  formatImportStatement(from: string, to: string, isTypeOnly: boolean): string;

  /**
   * Infer units by scanning source files in a directory.
   */
  inferUnits(dir: string, roleFolder: string, role: string): InferredUnit[];

  /**
   * Infer which interfaces a file implements by inspecting its source.
   */
  inferImplements(filePath: string): string[];

  /**
   * Check whether a filename is a source file for this language.
   */
  isSourceFile(filename: string): boolean;

  /**
   * Generate the CLAUDE.md content for a workspace.
   */
  generateClaudeMd(workspaceName: string): string;
}
