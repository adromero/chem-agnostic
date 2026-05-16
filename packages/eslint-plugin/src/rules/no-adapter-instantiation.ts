// ---------------------------------------------------------------------------
// CHEM-PORT-004 — ported from packages/core/src/checks/port-adapter-instantiation.ts
//
// Semantic: `new XAdapter()` is forbidden unless the call site is a
// CATALYST role file (catalysts are the wiring layer — instantiating
// adapters is their job). The reference rule also exempts:
//
//   • the @chemag-transient annotation (single-line comment immediately
//     preceding the class declaration)
//   • classes whose name is in DEFAULT_CLASS_ALLOWLIST (Date, URL, Money,
//     RegExp) or in the user-supplied `classAllowlist`
//   • test files (.test.ts / .spec.ts / under /tests/ or /__tests__/)
//   • intra-compound `new` calls (the class lives in the same compound as
//     the caller — that's not a port boundary)
//   • classes whose declaring file is NOT in any compound (node_modules,
//     stdlib, generated code, ...)
//
// Bench-driven extension (NEW vs the chemag rule):
//
//   • If the instantiated class transitively extends `Error`, exempt it.
//     Set `allowErrorSubclasses: false` to opt out. The Gate-1 bench
//     surfaced 7-8 false-positive hits where reactions were throwing
//     `new ChemDuplicatedFunctionError(...)` etc.; this allowlist removes
//     that noise.
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

const DEFAULT_CLASS_ALLOWLIST: readonly string[] = Object.freeze([
  "Date",
  "URL",
  "Money",
  "RegExp",
]);

export interface NoAdapterInstantiationOptions extends PathClassificationOptions {
  /** Class names exempt from the rule. Extends defaults. */
  classAllowlist?: string[];
  /**
   * When true (default), classes whose `extends` clause transitively
   * resolves to the built-in `Error` are exempt. Opt-out with `false`.
   */
  allowErrorSubclasses?: boolean;
  /**
   * Annotation comment that exempts an individual class declaration. The
   * comment must appear immediately above the class declaration. Default:
   * "@chemag-transient".
   */
  transientAnnotation?: string;
  /**
   * Compound names that are treated as "catalysts" — the wiring layer —
   * and may freely instantiate adapter classes from any compound. In
   * chemag's manifest world, this is `compound.type === "catalyst"`; in
   * the ESLint port we expose it as an opt because path-based
   * classification alone can't distinguish a catalyst compound from a
   * regular compound. Defaults to `[]` (no catalysts).
   *
   * Note: the `role` of the calling file is ALSO checked — files under a
   * `catalysts/` folder (role === "catalyst") are always exempted, even
   * if their compound isn't in this list.
   */
  catalystCompounds?: string[];
}

type Options = [NoAdapterInstantiationOptions];
type MessageIds = "adapterInstantiation";

const SCHEMA = {
  type: "object" as const,
  properties: {
    compoundsRoot: { type: "string" as const },
    adapterPaths: { type: "array" as const, items: { type: "string" as const } },
    interfacePaths: { type: "array" as const, items: { type: "string" as const } },
    reactionPaths: { type: "array" as const, items: { type: "string" as const } },
    catalystPaths: { type: "array" as const, items: { type: "string" as const } },
    classAllowlist: { type: "array" as const, items: { type: "string" as const } },
    allowErrorSubclasses: { type: "boolean" as const },
    transientAnnotation: { type: "string" as const },
    catalystCompounds: { type: "array" as const, items: { type: "string" as const } },
  },
  required: ["compoundsRoot"],
  additionalProperties: false,
};

export default createRule<Options, MessageIds>({
  name: "no-adapter-instantiation",
  meta: {
    type: "problem",
    docs: {
      description: "Only catalysts may instantiate adapters from other compounds",
    },
    messages: {
      adapterInstantiation:
        "'{{className}}' is an adapter from compound '{{otherCompound}}'. Only catalysts may instantiate it; reactions/adapters must depend on the interface.",
    },
    schema: [SCHEMA],
  },
  defaultOptions: [{ compoundsRoot: "", allowErrorSubclasses: true }],
  create(context) {
    const opts = context.options[0];
    if (!opts || !opts.compoundsRoot) return {};

    const allowErrorSubclasses = opts.allowErrorSubclasses !== false; // default true
    const transientAnnotation = opts.transientAnnotation ?? "@chemag-transient";
    const allowlist = new Set<string>([...DEFAULT_CLASS_ALLOWLIST, ...(opts.classAllowlist ?? [])]);
    const catalystCompounds = new Set<string>(opts.catalystCompounds ?? []);

    const filename = context.physicalFilename ?? context.filename;
    if (isTestFile(filename)) return {};

    const srcClass = classifyPath(filename, opts);
    if (srcClass.compound === null) return {}; // not in any compound
    if (srcClass.role === "catalyst") return {}; // catalysts ARE allowed to `new`
    if (catalystCompounds.has(srcClass.compound)) return {}; // catalyst-compound exempt

    const services = ESLintUtils.getParserServices(
      context,
      /* allowWithoutFullTypeInformation */ true,
    );
    const program = services.program;
    if (!program) return {};
    const checker = program.getTypeChecker();

    return {
      NewExpression(node) {
        // Only handle `new Foo(...)` where Foo is an Identifier (the
        // reference rule also skips namespace-style calls, e.g.
        // `new Module.Foo()`, and member-style calls).
        if (node.callee.type !== "Identifier") return;
        const className = node.callee.name;
        if (allowlist.has(className)) return;

        // Resolve the identifier's symbol via the TS checker.
        const calleeTsNode = services.esTreeNodeToTSNodeMap.get(node.callee);
        if (!calleeTsNode) return;
        const sym = checker.getSymbolAtLocation(calleeTsNode);
        if (!sym) return;

        const resolved = resolveImportedSymbol(sym, checker, 5);
        if (!resolved) return;

        // Find the resolved declaration. Must be a ClassDeclaration.
        const decl = (resolved.declarations ?? []).find(
          (d) => d.kind === ts.SyntaxKind.ClassDeclaration,
        ) as ts.ClassDeclaration | undefined;
        if (!decl) return;

        // Transient annotation: a `// @chemag-transient` (or configured token)
        // single-line comment immediately preceding the class declaration.
        if (hasTransientAnnotation(decl, transientAnnotation)) return;

        // Resolve the declaration's compound.
        const declSrcFile = getSymbolDeclarationSourceFile(resolved);
        if (!declSrcFile) return;
        const declPath = declSrcFile.fileName;

        const targetClass = classifyPath(declPath, opts);
        if (targetClass.compound === null) return; // outside compounds — node_modules, stdlib
        if (targetClass.role !== "adapter") return; // only adapters are gated
        // NOTE: unlike PORT-003, we DO NOT exempt same-compound instantiation
        // here. The reference rule fires when a non-catalyst compound's
        // reaction does `new Adapter()` REGARDLESS of whether the adapter
        // lives in the same compound or a different one — the rule is about
        // "only catalysts wire", not "only catalysts cross boundaries".

        // Error-allowlist (default-on, opt-out via `allowErrorSubclasses: false`).
        if (allowErrorSubclasses && extendsErrorTransitively(decl, checker)) {
          return;
        }

        context.report({
          node,
          messageId: "adapterInstantiation",
          data: {
            className,
            otherCompound: targetClass.compound,
          },
        });
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isTestFile(p: string): boolean {
  if (/\.(test|spec)\.tsx?$/.test(p)) return true;
  const segs = p.replace(/\\/g, "/").split("/");
  return segs.includes("tests") || segs.includes("__tests__");
}

function hasTransientAnnotation(decl: ts.ClassDeclaration, annotation: string): boolean {
  const sf = decl.getSourceFile();
  const text = sf.text;
  const ranges = ts.getLeadingCommentRanges(text, decl.getFullStart());
  if (!ranges) return false;
  for (const range of ranges) {
    const slice = text.slice(range.pos, range.end);
    if (slice.includes(annotation)) return true;
  }
  return false;
}

/**
 * Walk the class's `extends` chain up to 5 hops. If any link is the
 * built-in `Error` constructor, return true. Uses
 * `checker.getBaseTypes` which already follows the prototype chain — but
 * we cap explicitly to avoid pathological inputs.
 */
function extendsErrorTransitively(decl: ts.ClassDeclaration, checker: ts.TypeChecker): boolean {
  const seen = new Set<ts.Symbol>();
  let current: ts.ClassDeclaration | null = decl;
  let hops = 0;

  while (current !== null && hops < 5) {
    if (current.heritageClauses) {
      for (const clause of current.heritageClauses) {
        if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
        for (const type of clause.types) {
          const sym = checker.getSymbolAtLocation(type.expression);
          if (!sym) continue;
          if (sym.name === "Error") return true;
          const resolved = resolveImportedSymbol(sym, checker, 5) ?? sym;
          if (resolved.name === "Error") return true;
          if (seen.has(resolved)) {
            current = null;
            break;
          }
          seen.add(resolved);
          const baseDecl = (resolved.declarations ?? []).find(
            (d) => d.kind === ts.SyntaxKind.ClassDeclaration,
          ) as ts.ClassDeclaration | undefined;
          current = baseDecl ?? null;
        }
      }
    } else {
      current = null;
    }
    hops++;
  }
  return false;
}
