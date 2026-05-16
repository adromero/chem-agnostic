// ---------------------------------------------------------------------------
// CHEM-PORT-003 — ported from packages/core/src/checks/port-class-import.ts
//
// Semantic: a file in a "consumer" role (adapter/reaction/catalyst) must not
// directly import a `class` declaration from ANOTHER compound's public
// surface. Type-only imports, type aliases, interfaces, and functions are
// fine. Same-compound imports are fine. Test files are exempt. A
// configurable name allowlist (Date, URL, Money, RegExp + user-added) is
// exempt too. Compounds under a "reagent" path are exempt (their concrete
// types are part of the contract by design).
//
// Symbol resolution: barrel re-exports (`export { Foo } from "./internal"`)
// are followed via `resolveImportedSymbol` (one alias hop at a time, capped
// at depth 5). A chain deeper than the cap returns `null` and the rule does
// NOT fire — null is "unresolvable; do not flag" by contract.
// ---------------------------------------------------------------------------
import { ESLintUtils } from "@typescript-eslint/utils";
import ts from "typescript";
import { type PathClassificationOptions, classifyPath } from "../utils/path-classification.js";
import {
  getSymbolDeclarationSourceFile,
  resolveImportedSymbol,
} from "../utils/symbol-resolution.js";

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/adromero/chem-agnostic/blob/main/packages/eslint-plugin/docs/rules/${name}.md`,
);

/** Default class names that are allowed to cross compound boundaries. */
export const DEFAULT_CLASS_ALLOWLIST: readonly string[] = Object.freeze([
  "Date",
  "URL",
  "Money",
  "RegExp",
]);

export interface NoConcreteClassImportOptions extends PathClassificationOptions {
  /**
   * Absolute path(s) to "reagent" roots (the shared-kernel layer in chemag).
   * Imports of classes declared under any reagent root are EXEMPT — those
   * are shared-kernel types and their concrete shape IS the contract.
   * Defaults to empty (no reagent exemption).
   */
  reagentRoots?: string[];

  /**
   * Additional class names that may cross compound boundaries. Extends —
   * does NOT replace — DEFAULT_CLASS_ALLOWLIST.
   */
  classAllowlist?: string[];

  /**
   * Roles that are subject to the rule. Defaults to ["adapter", "reaction",
   * "catalyst"] (matches the reference rule). Files classified as a role
   * outside this list are not linted. Files with `role === "unknown"` are
   * also skipped.
   */
  consumerRoles?: ("adapter" | "reaction" | "catalyst" | "interface")[];
}

type Options = [NoConcreteClassImportOptions];
type MessageIds = "concreteClassImport";

const SCHEMA = {
  type: "object" as const,
  properties: {
    compoundsRoot: { type: "string" as const },
    adapterPaths: { type: "array" as const, items: { type: "string" as const } },
    interfacePaths: { type: "array" as const, items: { type: "string" as const } },
    reactionPaths: { type: "array" as const, items: { type: "string" as const } },
    catalystPaths: { type: "array" as const, items: { type: "string" as const } },
    reagentRoots: { type: "array" as const, items: { type: "string" as const } },
    classAllowlist: { type: "array" as const, items: { type: "string" as const } },
    consumerRoles: { type: "array" as const, items: { type: "string" as const } },
  },
  required: ["compoundsRoot"],
  additionalProperties: false,
};

export default createRule<Options, MessageIds>({
  name: "no-concrete-class-import",
  meta: {
    type: "problem",
    docs: {
      description: "Adapters must depend on interfaces, not concrete classes from other compounds",
    },
    messages: {
      concreteClassImport:
        "'{{name}}' is a concrete class from compound '{{otherCompound}}'. Import the interface instead.",
    },
    schema: [SCHEMA],
  },
  defaultOptions: [{ compoundsRoot: "" }],
  create(context) {
    const opts = context.options[0];
    if (!opts || !opts.compoundsRoot) return {};

    const consumerRoles = new Set<string>(
      opts.consumerRoles ?? ["adapter", "reaction", "catalyst"],
    );
    const allowlist = new Set<string>([...DEFAULT_CLASS_ALLOWLIST, ...(opts.classAllowlist ?? [])]);
    const reagentRoots = (opts.reagentRoots ?? []).map(normaliseSep);

    const filename = context.physicalFilename ?? context.filename;

    // Source-file gate (cheap rejections first):
    if (isTestFile(filename)) return {};

    const srcClass = classifyPath(filename, opts);
    if (srcClass.compound === null) return {};
    if (!consumerRoles.has(srcClass.role)) return {};

    // We need the TS Program from parserServices. If unavailable, skip silently —
    // the rule simply does nothing when type information is not provided.
    const services = ESLintUtils.getParserServices(
      context,
      /* allowWithoutFullTypeInformation */ true,
    );
    const program = services.program;
    if (!program) return {};
    const checker = program.getTypeChecker();

    return {
      ImportDeclaration(node) {
        // Skip `import type { ... }` entirely.
        if (node.importKind === "type") return;

        const specifiers = node.specifiers;
        if (specifiers.length === 0) return;

        for (const spec of specifiers) {
          if (spec.type !== "ImportSpecifier") {
            // Default and namespace imports — declarationKind is murky for
            // these; the reference rule skips them. Match that.
            continue;
          }
          // `import type { Foo } from ...` (per-specifier inline type kind)
          if (spec.importKind === "type") continue;

          const localName = spec.imported.type === "Identifier" ? spec.imported.name : null;
          if (localName === null) continue;
          if (allowlist.has(localName)) continue;

          // Resolve the local identifier to its TS symbol.
          const localTsNode = services.esTreeNodeToTSNodeMap.get(spec.local);
          if (!localTsNode) continue;
          const sym = checker.getSymbolAtLocation(localTsNode);
          if (!sym) continue;

          const resolved = resolveImportedSymbol(sym, checker, 5);
          if (!resolved) continue; // unresolvable — null contract: do not fire

          // Reject if the resolved declaration is not a class declaration.
          if (!isClassDeclaration(resolved)) continue;

          // Find the source file of the resolved class.
          const declSrcFile = getSymbolDeclarationSourceFile(resolved);
          if (!declSrcFile) continue;

          const declPath = declSrcFile.fileName;

          // Reagent exemption — classes under a reagent root are part of
          // the shared kernel and are allowed to cross boundaries.
          if (isUnderAnyRoot(declPath, reagentRoots)) continue;

          const targetClass = classifyPath(declPath, opts);
          if (targetClass.compound === null) continue; // out of project — node_modules etc.
          if (targetClass.compound === srcClass.compound) continue; // same compound — fine

          context.report({
            node: spec,
            messageId: "concreteClassImport",
            data: {
              name: localName,
              otherCompound: targetClass.compound,
            },
          });
        }
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isTestFile(p: string): boolean {
  // Basename pattern — matches .test.ts/.test.tsx/.spec.ts/.spec.tsx.
  if (/\.(test|spec)\.tsx?$/.test(p)) return true;
  // Directory components — "tests", "__tests__".
  const segs = p.replace(/\\/g, "/").split("/");
  return segs.includes("tests") || segs.includes("__tests__");
}

function isClassDeclaration(sym: ts.Symbol): boolean {
  const decls = sym.declarations;
  if (!decls || decls.length === 0) return false;
  for (const d of decls) {
    if (d.kind === ts.SyntaxKind.ClassDeclaration) return true;
  }
  return false;
}

function normaliseSep(p: string): string {
  return p.replace(/\\/g, "/");
}

function isUnderAnyRoot(absPath: string, roots: string[]): boolean {
  if (roots.length === 0) return false;
  const norm = normaliseSep(absPath);
  for (const r of roots) {
    const prefix = r.endsWith("/") ? r : `${r}/`;
    if (norm.startsWith(prefix)) return true;
  }
  return false;
}
