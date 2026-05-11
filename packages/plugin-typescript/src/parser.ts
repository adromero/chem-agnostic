import * as fs from "node:fs";
import * as path from "node:path";
import {
  Project,
  type SourceFile,
  type Symbol as TsMorphSymbol,
  type Node,
  type NewExpression,
  type ClassDeclaration,
  SyntaxKind,
} from "ts-morph";
import type {
  DeclarationKind,
  FunctionDeclarationSite,
  NewExpressionSite,
  ParsedImport,
} from "@chemag/core/types";

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

/**
 * Locate `new X(...)` expressions in the given files and return their
 * AST-extracted facts. Powers CHEM-PORT-004 (stateful adapter instantiation
 * must happen in a catalyst).
 *
 * Implementation note: builds a fresh ts-morph `Project` per call and
 * discards it after the scan, mirroring the lifecycle of
 * `parseImportsBatch` (see comment near the per-batch cache there). Cost
 * is one extra parse of the same files per sub-tree — acceptable for v1
 * because per-sub-tree file counts are small and the cost is dominated by
 * I/O, not parse. A shared-Project refactor is deferred (see R04 stage
 * spec § "Performance").
 *
 * The plugin returns ONLY AST facts; no workspace state is consulted here.
 * Filtering against roles, compound types, and the class allowlist is the
 * caller's responsibility (`@chemag/core/checks/port-adapter-instantiation`).
 */
export function scanNewExpressionsBatch(filePaths: string[]): Map<string, NewExpressionSite[]> {
  const result = new Map<string, NewExpressionSite[]>();

  if (filePaths.length === 0) return result;

  const project = new Project({
    compilerOptions: { allowJs: true, noEmit: true },
    skipAddingFilesFromTsConfig: true,
  });

  for (const fp of filePaths) {
    try {
      project.addSourceFileAtPath(fp);
    } catch {
      // File may not exist — will get empty array.
    }
  }

  // Per-batch cache: keyed by the resolved final-class declaration node
  // identity, so the same class referenced by many call sites only pays the
  // alias-walk / transient-detection cost once.
  const transientCache = new Map<ClassDeclaration, boolean>();

  for (const fp of filePaths) {
    const sourceFile = project.getSourceFile(fp);
    if (!sourceFile) {
      result.set(fp, []);
      continue;
    }
    result.set(fp, extractNewExpressions(sourceFile, transientCache));
  }

  return result;
}

/**
 * Enumerate top-level `function` declarations across the given files. Powers
 * CHEM-DRY-001 (function declared in N+ non-test files).
 *
 * Scope: ONLY `FunctionDeclaration` nodes whose parent is `SourceFile` —
 * arrow functions, methods, named exports of arrow assignments, and class
 * members are intentionally out of scope. The plan says "function declaration
 * with the same name" — interpret literally.
 *
 * Returns AST facts only — workspace filtering (test-file exclusion,
 * exclude-list, threshold) is the caller's job
 * (`@chemag/core/checks/duplicated-function`).
 */
export function scanFunctionDeclarationsBatch(
  filePaths: string[],
): Map<string, FunctionDeclarationSite[]> {
  const result = new Map<string, FunctionDeclarationSite[]>();

  if (filePaths.length === 0) return result;

  const project = new Project({
    compilerOptions: { allowJs: true, noEmit: true },
    skipAddingFilesFromTsConfig: true,
  });

  for (const fp of filePaths) {
    try {
      project.addSourceFileAtPath(fp);
    } catch {
      // File may not exist — empty array.
    }
  }

  for (const fp of filePaths) {
    const sourceFile = project.getSourceFile(fp);
    if (!sourceFile) {
      result.set(fp, []);
      continue;
    }
    result.set(fp, extractFunctionDeclarations(sourceFile));
  }

  return result;
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

/**
 * Walk every `new X(...)` expression in `sourceFile` and collect the
 * AST-only facts needed by CHEM-PORT-004. For each call site we attempt to
 * resolve the constructor identifier to its declaring `ClassDeclaration`
 * via the same depth-5 alias walk used by `resolveDeclarationKind`. Sites
 * whose constructor resolves to a non-class declaration (function, type,
 * namespace member, ...) yield `constructorDeclAbsPath = undefined` so the
 * core check treats them as a skip.
 */
function extractNewExpressions(
  sourceFile: SourceFile,
  transientCache: Map<ClassDeclaration, boolean>,
): NewExpressionSite[] {
  const sites: NewExpressionSite[] = [];
  const callerAbsPath = sourceFile.getFilePath();

  const newExprs = sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression) as NewExpression[];
  for (const ne of newExprs) {
    const expr = ne.getExpression();
    // The "class name" for a `new` expression is the rightmost identifier
    // (`new foo.Bar()` → "Bar"; `new Bar()` → "Bar"). Take the leaf
    // identifier text and resolve its symbol.
    let nameNode: Node = expr;
    if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      // ts-morph PropertyAccessExpression exposes getNameNode().
      const pae = expr as unknown as { getNameNode(): Node };
      try {
        nameNode = pae.getNameNode();
      } catch {
        nameNode = expr;
      }
    }
    const className = nameNode.getText();

    const classDecl = resolveDeclarationFile(nameNode);
    let constructorDeclAbsPath: string | undefined;
    let isTransient = false;

    if (classDecl) {
      try {
        constructorDeclAbsPath = classDecl.getSourceFile().getFilePath();
      } catch {
        constructorDeclAbsPath = undefined;
      }
      isTransient = hasTransientMarker(classDecl, transientCache);
    }

    sites.push({
      callerAbsPath,
      className,
      constructorDeclAbsPath,
      isTransient,
    });
  }

  return sites;
}

/**
 * Resolve an identifier node to its declaring `ClassDeclaration` (if any).
 *
 * Walks `getAliasedSymbol()` chains up to ALIAS_DEPTH_CAP, mirroring the
 * pattern used by `resolveDeclarationKind`. Returns the first
 * `ClassDeclaration` found among the final symbol's declarations, or
 * `undefined` when the resolver dead-ends, hits the cap, or the resolved
 * symbol's declarations contain no class (e.g. `new SomeType()` where
 * `SomeType` is a constructable interface or namespace member).
 */
function resolveDeclarationFile(node: Node): ClassDeclaration | undefined {
  let symbol: TsMorphSymbol | undefined;
  try {
    symbol = node.getSymbol();
  } catch {
    return undefined;
  }
  if (!symbol) return undefined;

  const seen = new Set<TsMorphSymbol>();
  let current: TsMorphSymbol = symbol;
  let depth = 0;
  while (depth < ALIAS_DEPTH_CAP) {
    if (seen.has(current)) return undefined;
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
    // Still aliased after the cap → treat as unresolved.
    let extra: TsMorphSymbol | undefined;
    try {
      extra = current.getAliasedSymbol();
    } catch {
      extra = undefined;
    }
    if (extra) return undefined;
  }

  let declarations: Node[] = [];
  try {
    declarations = current.getDeclarations();
  } catch {
    return undefined;
  }
  for (const d of declarations) {
    if (d.getKind() === SyntaxKind.ClassDeclaration) {
      return d as ClassDeclaration;
    }
  }
  return undefined;
}

/**
 * Detect a `@chemag-transient` marker in the class declaration's leading
 * trivia. Reads `getLeadingCommentRanges()` and substring-matches the
 * trimmed comment text — handles both `//` line comments and `/* ... *\/`
 * block comments. Deliberately NOT a JSDoc tag parse: the marker is a
 * convention, not part of the type system.
 */
function hasTransientMarker(
  classDecl: ClassDeclaration,
  cache: Map<ClassDeclaration, boolean>,
): boolean {
  const cached = cache.get(classDecl);
  if (cached !== undefined) return cached;

  let ranges: { getPos(): number; getEnd(): number }[] = [];
  try {
    // ts-morph node.getLeadingCommentRanges() returns CommentRange[].
    ranges = (
      classDecl as unknown as {
        getLeadingCommentRanges(): { getPos(): number; getEnd(): number }[];
      }
    ).getLeadingCommentRanges();
  } catch {
    ranges = [];
  }

  const fullText = classDecl.getSourceFile().getFullText();
  let found = false;
  for (const r of ranges) {
    const raw = fullText.slice(r.getPos(), r.getEnd());
    // Strip `//`, `/*`, `*/`, and any leading `*` line prefixes inside a
    // block comment. The marker text we care about is "@chemag-transient"
    // as a substring of the trimmed body.
    const stripped = raw
      .replace(/^\/\//, "")
      .replace(/^\/\*+/, "")
      .replace(/\*+\/$/, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, ""))
      .join("\n")
      .trim();
    if (stripped.includes("@chemag-transient")) {
      found = true;
      break;
    }
  }

  cache.set(classDecl, found);
  return found;
}

/**
 * Extract top-level `function` declarations from a source file. Only
 * declarations whose immediate parent is the `SourceFile` are considered —
 * function declarations nested inside a function body, a class, a namespace,
 * or any other container are NOT collected.
 *
 * Unnamed function declarations (rare in practice; only legal as
 * `export default function () {}`) are skipped — no `functionName` to key by.
 */
function extractFunctionDeclarations(sourceFile: SourceFile): FunctionDeclarationSite[] {
  const sites: FunctionDeclarationSite[] = [];
  const absPath = sourceFile.getFilePath();

  for (const fn of sourceFile.getFunctions()) {
    // ts-morph's `getFunctions()` returns only top-level function declarations
    // (parent is SourceFile) by design — nested functions live under the
    // containing function's body and are excluded.
    const name = fn.getName();
    if (!name) continue;
    let line: number | undefined;
    try {
      line = fn.getStartLineNumber();
    } catch {
      line = undefined;
    }
    const site: FunctionDeclarationSite = { functionName: name, absPath };
    if (line !== undefined) site.line = line;
    sites.push(site);
  }

  return sites;
}
