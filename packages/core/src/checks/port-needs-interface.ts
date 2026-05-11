// ---------------------------------------------------------------------------
// CHEM-PORT-001 — compound with concrete I/O must declare an interface.
//
// Pure, independently testable check used by the analyze phase
// (`import-check.ts`). Returns at most one diagnostic per compound — fired
// when ALL of the following hold:
//   1. The compound declares at least one reaction unit.
//   2. The compound declares at least one adapter unit.
//   3. The compound declares ZERO interface units.
//   4. At least one adapter source file imports a module matching the
//      effective I/O-module allowlist (defaults + workspace.rules.io_modules,
//      pre-validated by the loader).
//
// Architecture: the check is per-compound in granularity but runs inside
// `checkImports` (the only place where parsed source-level imports exist).
// `compileIoModulePatterns` is PURE — it assumes the loader has already
// pruned invalid `rules.io_modules` entries and emitted CHEM-MANIFEST-005
// for them. Invalid input at this layer is a programmer error (loader
// contract violation) and throws.
// ---------------------------------------------------------------------------
import * as path from "node:path";
import type { Diagnostic, LoadedCompound, ParsedImport } from "../types.js";
import { tr } from "../vocabulary/index.js";

/**
 * Default allowlist of I/O-module specifiers. User-supplied patterns
 * (`workspace.rules.io_modules`) EXTEND this list — they never replace it.
 *
 * Covers both bare and `node:` prefix forms for Node built-ins where
 * relevant. Globally-resolved `fetch` (no import statement) is intentionally
 * out of scope — detection here is import-only.
 */
export const IO_MODULE_PATTERNS: RegExp[] = [
  /^better-sqlite3$/,
  /^pg$/,
  /^pg-/,
  /^(node:)?fs(\/promises)?$/,
  /^(node:)?http$/,
  /^(node:)?https$/,
  /^(node:)?net$/,
  /^(node:)?dgram$/,
  /^axios$/,
  /^undici$/,
  /^mysql2(\/.+)?$/,
  /^mongodb$/,
  /^redis$/,
  /^ioredis$/,
  /^node-fetch$/,
  /^cross-fetch$/,
];

/**
 * Compile a user-supplied list of regex source strings into a flat
 * `RegExp[]` extending the default allowlist.
 *
 * PURE: assumes the loader has already pruned invalid entries and emitted
 * CHEM-MANIFEST-005 for them. Throws on invalid input (programmer error /
 * loader-contract violation). Callers in the analyze phase NEVER pass raw
 * unvalidated user input here.
 *
 * Semantics: `[...IO_MODULE_PATTERNS, ...userPatterns]` — user patterns
 * extend, never replace. Passing `undefined` returns the defaults verbatim.
 */
export function compileIoModulePatterns(userPatterns: string[] | undefined): RegExp[] {
  if (!userPatterns || userPatterns.length === 0) {
    return [...IO_MODULE_PATTERNS];
  }
  const userCompiled: RegExp[] = [];
  for (const src of userPatterns) {
    // `new RegExp` is idempotent for already-validated source strings; we
    // re-compile here so the function is self-contained for direct callers.
    userCompiled.push(new RegExp(src));
  }
  return [...IO_MODULE_PATTERNS, ...userCompiled];
}

/**
 * Per-compound PORT-001 check.
 *
 * @param compound        the compound under inspection
 * @param importsForFile  closure returning the parsed imports for an
 *                        absolute file path (typically backed by the
 *                        per-sub-tree batchResult inside checkImports)
 * @param patterns        the effective allowlist (defaults + user patterns)
 * @param subtreeId       the sub-tree id this compound lives in, threaded
 *                        through to the diagnostic's `language_id`
 *
 * @returns one Diagnostic when the compound matches the rule, otherwise undefined.
 */
export function checkPortNeedsInterface(
  compound: LoadedCompound,
  importsForFile: (absPath: string) => ParsedImport[] | undefined,
  patterns: RegExp[],
  subtreeId: string | undefined,
): Diagnostic | undefined {
  const units = compound.manifest.units ?? [];
  const reactions = units.filter((u) => u.role === "reaction");
  const adapters = units.filter((u) => u.role === "adapter");
  const interfaces = units.filter((u) => u.role === "interface");

  // Rule guards — short-circuit before scanning source.
  if (reactions.length === 0) return undefined;
  if (adapters.length === 0) return undefined;
  if (interfaces.length > 0) return undefined;

  // Collect ALL matching I/O module specifiers across every adapter.
  // We dedupe so the diagnostic message lists each module at most once.
  const matchedModules = new Set<string>();
  for (const adapter of adapters) {
    const abs = path.resolve(compound.dir, adapter.file);
    const imports = importsForFile(abs);
    if (!imports || imports.length === 0) continue;
    for (const imp of imports) {
      for (const re of patterns) {
        if (re.test(imp.moduleSpecifier)) {
          matchedModules.add(imp.moduleSpecifier);
          break;
        }
      }
    }
  }

  if (matchedModules.size === 0) return undefined;

  const ioList = [...matchedModules].sort().join(", ");
  const diag: Diagnostic = {
    level: "warning",
    check: "port-needs-interface",
    code: "CHEM-PORT-001",
    compound: compound.manifest.compound,
    message: tr("diagnostic.port_needs_interface", {
      compound: compound.manifest.compound,
      io_modules: ioList,
    }),
    hint: `Extract an interface unit (e.g. \`${compound.manifest.compound}-port\`), make the reactions depend on it, and bind the adapter to the interface via a catalyst/composition-root.`,
  };
  if (subtreeId !== undefined) {
    diag.language_id = subtreeId;
  }
  return diag;
}
