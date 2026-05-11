import * as fs from "node:fs";
import * as path from "node:path";
import {
  Project,
  type SourceFile,
  type Symbol as TsMorphSymbol,
  type Node,
  SyntaxKind,
} from "ts-morph";
import type { DeclarationKind, ParsedImport } from "@chemag/core/types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse import statements from multiple files in a single ts-morph Project.
 * Returns a Map from file path to its parsed imports.
 * For missing/unreadable files, returns an empty array.
 *
 * Each `ParsedImport` carries a best-effort `declarationKind` resolving the
 * import's primary name through `getAliasedSymbol()` chains up to depth 5.
 * Used by CHEM-PORT-003 (cross-compound class imports).
 */
export function parseImportsBatch(filePaths: string[]): Map<string, ParsedImport[]> {
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

  // Per-batch symbol-resolution cache: keyed by (sourceFile path, name) so
  // repeated imports of the same name across files don't re-walk the chain.
  // Lifetime is exactly one `parseImportsBatch` call — the Project is
  // discarded afterwards so cached `Symbol` references would dangle.
  const cache = new Map<string, DeclarationKind>();

  for (const fp of filePaths) {
    const sourceFile = project.getSourceFile(fp);
    if (!sourceFile) {
      result.set(fp, []);
      continue;
    }
    result.set(fp, extractImports(sourceFile, cache));
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
export function resolveModulePath(fromFile: string, moduleSpec: string): string | undefined {
  // Skip bare/package imports (node_modules)
  if (!moduleSpec.startsWith(".") && !moduleSpec.startsWith("/")) {
    return undefined;
  }

  const dir = path.dirname(fromFile);
  const base = path.resolve(dir, moduleSpec);

  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];

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

const ALIAS_DEPTH_CAP = 5;

function extractImports(
  sourceFile: SourceFile,
  cache: Map<string, DeclarationKind>,
): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const filePath = sourceFile.getFilePath();

  for (const decl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    const isTypeOnly = decl.isTypeOnly();

    const names: string[] = [];
    let primaryNameNode: Node | undefined;

    // Default import
    const defaultImport = decl.getDefaultImport();
    if (defaultImport) {
      names.push(defaultImport.getText());
      if (!primaryNameNode) primaryNameNode = defaultImport;
    }

    // Named imports
    for (const named of decl.getNamedImports()) {
      names.push(named.getName());
      if (!primaryNameNode) primaryNameNode = named.getNameNode();
    }

    // Namespace import (`* as foo`) — declarationKind stays undefined; no
    // useful per-symbol resolution for the bag of re-exports.
    let isNamespace = false;
    const nsImport = decl.getNamespaceImport();
    if (nsImport) {
      names.push(`* as ${nsImport.getText()}`);
      isNamespace = true;
    }

    let declarationKind: DeclarationKind | undefined;
    // Skip symbol resolution for `import type { ... }` — PORT-003 (the only
    // current consumer of `declarationKind`) treats type-only imports as
    // safe regardless of declaration kind, and symbol-walking is the
    // expensive part of this parser. Saves cold-start latency on workspaces
    // dominated by type-only imports (the common shape).
    if (!isNamespace && !isTypeOnly && primaryNameNode) {
      const primaryName = primaryNameNode.getText();
      declarationKind = resolveDeclarationKind(filePath, primaryName, primaryNameNode, cache);
    }

    const imp: ParsedImport = { moduleSpecifier, names, isTypeOnly };
    if (declarationKind !== undefined) imp.declarationKind = declarationKind;
    imports.push(imp);
  }

  // Re-exports (export { X } from "./foo")
  for (const exportDecl of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifier) continue; // local re-export, no module

    const isTypeOnly = exportDecl.isTypeOnly();
    const names: string[] = [];
    let primaryNameNode: Node | undefined;

    for (const named of exportDecl.getNamedExports()) {
      names.push(named.getName());
      if (!primaryNameNode) primaryNameNode = named.getNameNode();
    }

    if (names.length > 0) {
      let declarationKind: DeclarationKind | undefined;
      // Same type-only short-circuit as the import branch above.
      if (!isTypeOnly && primaryNameNode) {
        const primaryName = primaryNameNode.getText();
        declarationKind = resolveDeclarationKind(filePath, primaryName, primaryNameNode, cache);
      }
      const imp: ParsedImport = { moduleSpecifier, names, isTypeOnly };
      if (declarationKind !== undefined) imp.declarationKind = declarationKind;
      imports.push(imp);
    }
  }

  return imports;
}

/**
 * Resolve a single named import (or re-export) to a `DeclarationKind`. Walks
 * `getAliasedSymbol()` chains up to ALIAS_DEPTH_CAP (matches the plan's
 * depth-5 limit). Returns "unresolved" when the cap is hit or the chain
 * dead-ends without a final declaration; returns undefined only when no
 * symbol is resolvable at all (so the consumer treats it as a no-op).
 */
function resolveDeclarationKind(
  sourceFilePath: string,
  name: string,
  node: Node,
  cache: Map<string, DeclarationKind>,
): DeclarationKind | undefined {
  const cacheKey = `${sourceFilePath}::${name}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  let symbol: TsMorphSymbol | undefined;
  try {
    symbol = node.getSymbol();
  } catch {
    return undefined;
  }
  if (!symbol) return undefined;

  // Walk alias chain: import-binding symbols and re-export symbols both
  // expose `getAliasedSymbol()`. We bound the walk so a cyclic graph or
  // pathological barrel cannot stall analyze.
  const seen = new Set<TsMorphSymbol>();
  let current: TsMorphSymbol = symbol;
  let depth = 0;
  while (depth < ALIAS_DEPTH_CAP) {
    if (seen.has(current)) {
      cache.set(cacheKey, "unresolved");
      return "unresolved";
    }
    seen.add(current);

    let next: TsMorphSymbol | undefined;
    try {
      next = current.getAliasedSymbol();
    } catch {
      next = undefined;
    }
    if (!next) break;
    current = next;
    depth++;
  }

  if (depth >= ALIAS_DEPTH_CAP) {
    // Try one more hop only to detect "still aliased after cap" → unresolved.
    let extra: TsMorphSymbol | undefined;
    try {
      extra = current.getAliasedSymbol();
    } catch {
      extra = undefined;
    }
    if (extra) {
      cache.set(cacheKey, "unresolved");
      return "unresolved";
    }
  }

  const kind = inspectFinalSymbol(current);
  cache.set(cacheKey, kind);
  return kind;
}

/**
 * Map the final (non-aliased) symbol's declarations to a `DeclarationKind`.
 * Inspects every declaration node attached to the symbol and picks the most
 * specific kind (class > interface > type > function > value), falling back
 * to "unresolved" when no declarations are present.
 */
function inspectFinalSymbol(symbol: TsMorphSymbol): DeclarationKind {
  let declarations: Node[] = [];
  try {
    declarations = symbol.getDeclarations();
  } catch {
    return "unresolved";
  }
  if (!declarations || declarations.length === 0) return "unresolved";

  // Priority order — most architecturally significant wins. A symbol that
  // is both a class and a value (via declaration merging) is reported as
  // "class" because PORT-003 cares about concrete class boundaries.
  const saw: { class: boolean; iface: boolean; type: boolean; func: boolean; value: boolean } = {
    class: false,
    iface: false,
    type: false,
    func: false,
    value: false,
  };

  for (const d of declarations) {
    const kind = d.getKind();
    switch (kind) {
      case SyntaxKind.ClassDeclaration:
      case SyntaxKind.ClassExpression:
        saw.class = true;
        break;
      case SyntaxKind.InterfaceDeclaration:
        saw.iface = true;
        break;
      case SyntaxKind.TypeAliasDeclaration:
        saw.type = true;
        break;
      case SyntaxKind.FunctionDeclaration:
      case SyntaxKind.FunctionExpression:
      case SyntaxKind.ArrowFunction:
        saw.func = true;
        break;
      case SyntaxKind.VariableDeclaration:
      case SyntaxKind.VariableStatement:
      case SyntaxKind.EnumDeclaration:
      case SyntaxKind.EnumMember:
      case SyntaxKind.ModuleDeclaration:
        saw.value = true;
        break;
      default:
        // Unknown / unhandled declaration kind — treat as "value" so the
        // check stays conservative (no false-positive class diagnostic).
        saw.value = true;
        break;
    }
  }

  if (saw.class) return "class";
  if (saw.iface) return "interface";
  if (saw.type) return "type";
  if (saw.func) return "function";
  if (saw.value) return "value";
  return "unresolved";
}
