// ---------------------------------------------------------------------------
// runFixture — shared test harness for the Track R semantic-rule fixtures.
//
// Loads a fixture workspace from disk, runs the full check + analyze
// pipeline in-process, and returns the diagnostics from each phase
// separately. No subprocesses, no global state.
//
// Architecture note: this helper lives inside `@chemag/core` test code and
// MUST NOT import from any plugin package (CLAUDE.md constraint — `ts-morph`
// is confined to its plugin and `@chemag/core` has no dependency on it). The
// analyze phase still needs a `LanguagePlugin` instance, so callers either
// inject one via the `plugin` option (see `mockPlugin(importMap, resolutions)`
// in `packages/core/test/import-check.test.ts`) or accept the bundled no-op
// plugin defined at module scope below.
// ---------------------------------------------------------------------------
import * as path from "node:path";
import {
  discoverCompounds,
  discoverCompoundsBySubtree,
  loadWorkspaceWithDiagnostics,
} from "../../src/loader.js";
import { allChecks } from "../../src/checks.js";
import { checkImports, type ImportCheckScope } from "../../src/import-check.js";
import type { LanguagePlugin } from "../../src/plugin-interface.js";
import type { CheckOptions, Diagnostic } from "../../src/types.js";

export interface RunFixtureOptions {
  /**
   * Optional language plugin used for the analyze phase. When omitted, the
   * bundled `NOOP_PLUGIN` is used — its `parseImportsBatch` returns an empty
   * map and `resolveModulePath` returns `undefined`, so analyze runs end-to-end
   * but emits no source-level diagnostics. Tests that need real or mocked
   * import resolution supply their own plugin (typically following the
   * `mockPlugin(importMap, resolutions)` pattern in
   * `packages/core/test/import-check.test.ts`).
   */
  plugin?: LanguagePlugin;
  /**
   * CheckOptions passed to every entry in `allChecks`. Defaults to
   * `{ manifestOnly: false }` so file-existence and public-surface checks
   * run against the on-disk fixture (the realistic mode for R02-R05 rule
   * tests). Override to `{ manifestOnly: true }` when a fixture is
   * intentionally manifest-only.
   */
  checkOptions?: CheckOptions;
}

export interface RunFixtureResult {
  checkDiagnostics: Diagnostic[];
  analyzeDiagnostics: Diagnostic[];
}

/**
 * Bundled no-op `LanguagePlugin`. Implements every method on the
 * `LanguagePlugin` interface but with empty / undefined return values, so
 * the analyze pipeline runs deterministically without producing source-level
 * diagnostics. Tests can pass their own plugin via `RunFixtureOptions.plugin`
 * to exercise real import-resolution logic.
 */
export const NOOP_PLUGIN: LanguagePlugin = {
  name: "noop",
  fileExtensions: [],
  defaults: {
    publicSurface: "public.ts",
    testFilePattern: /\.test$/,
    testFrameworkImport: "vitest",
  },
  parseImportsBatch() {
    return new Map();
  },
  parseImports() {
    return [];
  },
  resolveModulePath() {
    return undefined;
  },
  generateUnitStub() {
    return "";
  },
  generatePublicSurface() {
    return "";
  },
  generateAssayStub() {
    return "";
  },
  unitFilePath() {
    return "";
  },
  formatRelativeImport() {
    return "";
  },
  formatImportStatement() {
    return "";
  },
  inferUnits() {
    return [];
  },
  inferImplements() {
    return [];
  },
  isSourceFile() {
    return false;
  },
  generateClaudeMd() {
    return "";
  },
};

/**
 * Load the workspace at `<fixtureDir>/workspace.yaml`, run the check phase
 * (every entry in `allChecks`) and the analyze phase (`checkImports`), and
 * return the resulting diagnostics grouped by phase.
 *
 * Deterministic: the function reads filesystem state only via `loadWorkspace`
 * and `discoverCompounds*`, holds no module-level mutable state, and never
 * spawns subprocesses.
 */
export async function runFixture(
  fixtureDir: string,
  opts: RunFixtureOptions = {},
): Promise<RunFixtureResult> {
  const wsPath = path.join(fixtureDir, "workspace.yaml");
  const { workspace, diagnostics: loaderDiagnostics } = loadWorkspaceWithDiagnostics(wsPath);
  const checkOptions: CheckOptions = opts.checkOptions ?? { manifestOnly: false };
  const plugin = opts.plugin ?? NOOP_PLUGIN;

  // -- check phase ---------------------------------------------------------
  // Loader diagnostics (e.g. CHEM-MANIFEST-005 for invalid rules.io_modules
  // regexes) fold into the check-phase bucket — they're manifest-shape
  // diagnostics, conceptually a peer of the entries in `allChecks`.
  const compounds = discoverCompounds(workspace, fixtureDir);
  const checkDiagnostics: Diagnostic[] = [...loaderDiagnostics];
  for (const { fn } of allChecks) {
    checkDiagnostics.push(...fn(workspace, compounds, checkOptions));
  }

  // -- analyze phase -------------------------------------------------------
  const grouped = discoverCompoundsBySubtree(workspace, fixtureDir);
  const scopes: ImportCheckScope[] = grouped.map((g) => ({
    plugin,
    scope: g.scope,
    compounds: g.compounds,
  }));
  const analyzeDiagnostics = checkImports(workspace, scopes);

  return { checkDiagnostics, analyzeDiagnostics };
}
