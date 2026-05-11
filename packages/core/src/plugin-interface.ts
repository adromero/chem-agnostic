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
   * Locate `new X(...)` expressions in the given files and return their
   * AST-extracted facts. OPTIONAL — plugins that cannot resolve constructor
   * symbols (e.g. plugin-python) MAY omit this method, in which case the
   * core check skips and emits no diagnostics for that sub-tree.
   *
   * The plugin MUST NOT consult workspace state. All filtering against
   * roles / compound types happens in `@chemag/core/checks`.
   *
   * Returns a Map from each input file path to its sites. Files with no
   * `new` expressions MAY be omitted from the result (callers must treat
   * a missing entry as an empty list).
   */
  scanNewExpressions?(filePaths: string[]): Map<string, NewExpressionSite[]>;

  /**
   * Enumerate top-level `function` declarations in the given files and return
   * their AST-extracted facts. OPTIONAL — plugins that cannot enumerate
   * function declarations (e.g. plugin-python in v1) MAY omit this method, in
   * which case the core duplicated-function check skips the sub-tree entirely.
   *
   * The plugin MUST scan ONLY top-level `FunctionDeclaration` nodes (parent
   * is `SourceFile`). Arrow functions, methods, named exports of arrow
   * assignments, and class members are intentionally out of scope.
   *
   * Workspace filtering (test-file exclusion, exclude-list, threshold) lives
   * in `@chemag/core/checks/duplicated-function.ts` — the plugin must NOT
   * consult workspace state.
   *
   * Returns a Map from each input file path to its sites. Files with no
   * top-level function declarations MAY be omitted from the result.
   */
  scanFunctionDeclarations?(filePaths: string[]): Map<string, FunctionDeclarationSite[]>;

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
