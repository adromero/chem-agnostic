import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ParsedImport, WorkspaceRules } from "../../src/types.js";

/** Path to the Python import parsing script. */
const SCRIPT_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "parse_imports.py",
);

/**
 * Discover the Python interpreter path.
 * Checks CHEM_PYTHON env var first, then falls back to "python3".
 */
export function discoverPython(): string {
  const envPython = process.env["CHEM_PYTHON"];
  if (envPython) {
    return envPython;
  }
  return "python3";
}

/** Shape of a single result from parse_imports.py */
interface ParseResult {
  file: string;
  imports?: Array<{
    moduleSpecifier: string;
    names: string[];
    isTypeOnly: boolean;
  }>;
  error?: string;
}

/**
 * Parse imports from multiple Python files in a single subprocess call.
 * Returns a map from file path to its parsed imports.
 */
export function parseImportsBatch(
  filePaths: string[],
): Map<string, ParsedImport[]> {
  const result = new Map<string, ParsedImport[]>();
  if (filePaths.length === 0) return result;

  const pythonPath = discoverPython();
  const jsonInput = JSON.stringify(filePaths);

  const stdout = execFileSync(pythonPath, [SCRIPT_PATH], {
    input: jsonInput,
    timeout: 30_000,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });

  const parsed: ParseResult[] = JSON.parse(stdout);

  for (const entry of parsed) {
    if (entry.error) {
      // On per-file error, store empty imports
      result.set(entry.file, []);
    } else if (entry.imports) {
      result.set(
        entry.file,
        entry.imports.map((imp) => ({
          moduleSpecifier: imp.moduleSpecifier,
          names: imp.names,
          isTypeOnly: imp.isTypeOnly,
        })),
      );
    }
  }

  return result;
}

/**
 * Parse imports from a single Python file.
 */
export function parseImports(filePath: string): ParsedImport[] {
  const batch = parseImportsBatch([filePath]);
  return batch.get(filePath) ?? [];
}

/**
 * Resolve a Python module specifier to an absolute file path.
 *
 * - Relative imports (.module, ..module) are resolved from the importing file's directory.
 * - Absolute imports are checked against workspace python_packages.
 * - Returns undefined for stdlib/third-party modules.
 */
export function resolveModulePath(
  fromFile: string,
  moduleSpec: string,
  workspaceRoot?: string,
  rules?: WorkspaceRules,
): string | undefined {
  // Count leading dots for relative imports
  let level = 0;
  while (level < moduleSpec.length && moduleSpec[level] === ".") {
    level++;
  }

  if (level > 0) {
    // Relative import
    const modulePart = moduleSpec.slice(level);
    let baseDir = path.dirname(fromFile);

    // Go up (level - 1) directories for each extra dot
    for (let i = 1; i < level; i++) {
      baseDir = path.dirname(baseDir);
    }

    if (modulePart === "") {
      // `from . import X` -> resolve to __init__.py in baseDir
      const initPath = path.join(baseDir, "__init__.py");
      return existsSync(initPath) ? initPath : undefined;
    }

    // Convert dotted module path to file path segments
    const segments = modulePart.split(".");
    const modulePath = path.join(baseDir, ...segments);

    // Try as a direct .py file
    const pyFile = modulePath + ".py";
    if (existsSync(pyFile)) return pyFile;

    // Try as a package (__init__.py)
    const initFile = path.join(modulePath, "__init__.py");
    if (existsSync(initFile)) return initFile;

    return undefined;
  }

  // Absolute import — check python_packages for intra-project modules
  if (workspaceRoot && rules?.python_packages) {
    const topLevel = moduleSpec.split(".")[0];
    if (rules.python_packages.includes(topLevel)) {
      const segments = moduleSpec.split(".");
      const modulePath = path.join(workspaceRoot, ...segments);

      const pyFile = modulePath + ".py";
      if (existsSync(pyFile)) return pyFile;

      const initFile = path.join(modulePath, "__init__.py");
      if (existsSync(initFile)) return initFile;
    }
  }

  // Stdlib or third-party — cannot resolve
  return undefined;
}
