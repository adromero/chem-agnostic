import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ParsedImport, WorkspaceRules } from "../../src/types.js";

/**
 * Discover the Python interpreter path.
 * Retained for generator/test helpers that still shell out to Python.
 */
export function discoverPython(): string {
  const envPython = process.env["CHEM_PYTHON"];
  if (envPython) {
    return envPython;
  }
  return "python3";
}

function countIndent(line: string): number {
  let indent = 0;
  for (const ch of line) {
    if (ch === " ") indent += 1;
    else if (ch === "\t") indent += 8;
    else break;
  }
  return indent;
}

function countParenDelta(line: string): number {
  let delta = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    const next3 = line.slice(i, i + 3);

    if (quote) {
      if (next3 === quote.repeat(3)) {
        i += 2;
        quote = null;
        continue;
      }
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (next3 === '"""' || next3 === "'''") {
      quote = line[i]!;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#") {
      break;
    }
    if (ch === "(" || ch === "[" || ch === "{") delta += 1;
    if (ch === ")" || ch === "]" || ch === "}") delta -= 1;
  }
  return delta;
}

function splitCommaSeparated(value: string): string[] {
  const normalized = value
    .replace(/[\\\n\r]/g, " ")
    .replace(/^\((.*)\)$/s, "$1")
    .trim();

  if (!normalized) return [];

  return normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseImportStatement(statement: string, isTypeOnly: boolean): ParsedImport[] {
  const normalized = statement.trim();
  if (!normalized) return [];

  const importMatch = normalized.match(/^import\s+(.+)$/s);
  if (importMatch) {
    return splitCommaSeparated(importMatch[1] ?? "").map((part) => {
      const [moduleName, alias] = part.split(/\s+as\s+/i).map((item) => item.trim());
      return {
        moduleSpecifier: moduleName,
        names: [alias || moduleName.split(".").pop() || moduleName],
        isTypeOnly,
      };
    });
  }

  const fromMatch = normalized.match(/^from\s+([.\w]+)\s+import\s+(.+)$/s);
  if (!fromMatch) return [];

  const moduleSpecifier = fromMatch[1] ?? "";
  if (moduleSpecifier === "__future__") return [];

  return [
    {
      moduleSpecifier,
      names: splitCommaSeparated(fromMatch[2] ?? "").map((part) => {
        if (part === "*") return "*";
        const [name, alias] = part.split(/\s+as\s+/i).map((item) => item.trim());
        return alias || name;
      }),
      isTypeOnly,
    },
  ];
}

function parsePythonImports(source: string): ParsedImport[] {
  const results: ParsedImport[] = [];
  const lines = source.split(/\r?\n/);
  const typeOnlyStack: Array<{ indent: number; isTypeOnly: boolean }> = [];

  let statementLines: string[] = [];
  let statementIndent = 0;
  let parenBalance = 0;
  let insideTriple: string | null = null;

  const flushStatement = () => {
    if (statementLines.length === 0) return;

    const parent = typeOnlyStack[typeOnlyStack.length - 1];
    const isTypeOnly = parent?.isTypeOnly ?? false;
    const statement = statementLines.join("\n").trim();

    if (!statement) {
      statementLines = [];
      statementIndent = 0;
      parenBalance = 0;
      return;
    }

    if (/^if\s+(?:typing\.)?TYPE_CHECKING\s*:/.test(statement)) {
      typeOnlyStack.push({ indent: statementIndent, isTypeOnly: true });
    } else if (statementIndent === 0 || isTypeOnly) {
      results.push(...parseImportStatement(statement, isTypeOnly));
    }

    statementLines = [];
    statementIndent = 0;
    parenBalance = 0;
  };

  for (const rawLine of lines) {
    const indent = countIndent(rawLine);
    const trimmed = rawLine.trim();

    if (statementLines.length === 0) {
      while (
        typeOnlyStack.length > 0 &&
        indent <= typeOnlyStack[typeOnlyStack.length - 1]!.indent &&
        trimmed !== ""
      ) {
        typeOnlyStack.pop();
      }
    }

    if (insideTriple) {
      if (rawLine.includes(insideTriple)) {
        insideTriple = null;
      }
      continue;
    }

    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
      const marker = trimmed.slice(0, 3);
      if (trimmed.indexOf(marker, 3) === -1) {
        insideTriple = marker;
      }
      continue;
    }

    if (statementLines.length === 0) {
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      statementIndent = indent;
    }

    statementLines.push(rawLine);
    parenBalance += countParenDelta(rawLine);

    const continues = trimmed.endsWith("\\") || parenBalance > 0;
    if (!continues) {
      flushStatement();
    }
  }

  flushStatement();
  return results;
}

/**
 * Parse imports from multiple Python files without shelling out to Python.
 * This avoids Node->Python subprocess issues in restricted environments.
 */
export function parseImportsBatch(
  filePaths: string[],
): Map<string, ParsedImport[]> {
  const result = new Map<string, ParsedImport[]>();
  if (filePaths.length === 0) return result;

  for (const filePath of filePaths) {
    try {
      const source = readFileSync(filePath, "utf-8");
      result.set(filePath, parsePythonImports(source));
    } catch {
      result.set(filePath, []);
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
  let level = 0;
  while (level < moduleSpec.length && moduleSpec[level] === ".") {
    level++;
  }

  if (level > 0) {
    const modulePart = moduleSpec.slice(level);
    let baseDir = path.dirname(fromFile);

    for (let i = 1; i < level; i++) {
      baseDir = path.dirname(baseDir);
    }

    if (modulePart === "") {
      const initPath = path.join(baseDir, "__init__.py");
      return existsSync(initPath) ? initPath : undefined;
    }

    const segments = modulePart.split(".");
    const modulePath = path.join(baseDir, ...segments);
    const pyFile = modulePath + ".py";
    if (existsSync(pyFile)) return pyFile;

    const initFile = path.join(modulePath, "__init__.py");
    if (existsSync(initFile)) return initFile;

    return undefined;
  }

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

  return undefined;
}
