import type * as ts from "typescript";

/**
 * Internal: extend the public TypeChecker type to include the
 * `getImmediateAliasedSymbol` method which is present in all TypeScript
 * versions we support (≥4.8.4) but is not part of the public declaration.
 * Using it lets us walk the alias chain one hop at a time, which is required
 * for correct depth-limiting behaviour.
 */
interface TypeCheckerWithImmediateAlias extends ts.TypeChecker {
  getImmediateAliasedSymbol(symbol: ts.Symbol): ts.Symbol | undefined;
}

/**
 * Walk an alias chain in the TypeScript type system, resolving re-exports and
 * barrel files, one hop at a time, up to `maxDepth` hops.
 *
 * **Null-return contract (callers must read this):**
 * `resolveImportedSymbol` returns `null` when the alias chain exceeds
 * `maxDepth` *or* when the chain cannot be resolved to a declaration
 * (e.g., the symbol has no declarations). Callers (the three rules)
 * MUST treat `null` as **"unresolvable — do not fire"** to avoid
 * false positives on deep barrel re-export chains. Firing on
 * unresolved symbols would flag every barrel that happens to be
 * deeper than 5 hops, which would be noisy and wrong.
 *
 * Implementation note: We use `getImmediateAliasedSymbol` (one hop at a
 * time) rather than `getAliasedSymbol` (which follows the entire chain
 * at once internally) so that the `maxDepth` guard is actually meaningful.
 * `getImmediateAliasedSymbol` is an internal TypeScript API that has been
 * stable since TS 2.x. If it is unexpectedly absent (future TS version),
 * the function falls back to `getAliasedSymbol` and treats the result as
 * a single hop.
 *
 * @param symbol   The symbol as seen at the import site.
 * @param checker  The TypeChecker for the current TS Program.
 * @param maxDepth Maximum number of alias hops to follow (default: 5).
 *                 If the chain is longer, returns `null`.
 * @returns The concrete (non-alias) symbol at the declaration site, or
 *          `null` if unresolvable.
 */
export function resolveImportedSymbol(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  maxDepth = 5,
): ts.Symbol | null {
  const ALIAS_FLAG = 2097152; // ts.SymbolFlags.Alias

  // Cast to the extended interface; getImmediateAliasedSymbol may be undefined
  // on a hypothetical future TS version.
  const extChecker = checker as TypeCheckerWithImmediateAlias;
  const hasImmediateAlias = typeof extChecker.getImmediateAliasedSymbol === "function";

  let current: ts.Symbol = symbol;
  let hops = 0;

  while (hops < maxDepth) {
    // If the current symbol is NOT an alias, we've reached the declaration.
    if ((current.flags & ALIAS_FLAG) === 0) {
      return current;
    }

    let next: ts.Symbol | undefined;

    if (hasImmediateAlias) {
      // Walk exactly one hop.
      next = extChecker.getImmediateAliasedSymbol(current);
    } else {
      // Fallback: follow the full chain at once (depth limiting is best-effort).
      next = checker.getAliasedSymbol(current);
    }

    // If next is the same symbol or undefined, the chain cannot be resolved.
    if (!next || next === current) {
      return null;
    }

    current = next;
    hops++;
  }

  // Exceeded maxDepth — return null to signal "unresolvable".
  return null;
}

/**
 * Return the `ts.SourceFile` node that contains the symbol's (first)
 * declaration, or `null` if the symbol has no declarations.
 *
 * **Null-return contract:** `null` is returned when `sym.declarations` is
 * undefined or empty. Callers must treat this as "unresolvable — do not
 * fire" for the same reasons as `resolveImportedSymbol`.
 *
 * @param sym A fully-resolved (non-alias) `ts.Symbol`.
 * @returns The source file of the first declaration, or `null`.
 */
export function getSymbolDeclarationSourceFile(sym: ts.Symbol): ts.SourceFile | null {
  const decls = sym.declarations;
  if (!decls || decls.length === 0) {
    return null;
  }
  return decls[0].getSourceFile();
}
