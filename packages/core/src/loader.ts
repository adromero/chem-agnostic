import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Workspace, LoadedCompound, Compound, LanguageSubtree, Diagnostic } from "./types.js";
import { tr } from "./vocabulary/index.js";

/**
 * Result of `loadWorkspaceWithDiagnostics`: the parsed (and, where the
 * loader recovered from a soft error, normalized) workspace plus any
 * non-fatal diagnostics produced during load.
 *
 * Today the only diagnostics surfaced through this channel are
 * `CHEM-MANIFEST-005` (invalid `rules.io_modules` regex), but the API
 * is intentionally general so future "recoverable manifest-shape"
 * diagnostics can fold in without breaking callers.
 *
 * Hard schema errors (missing `workspace:`, invalid `vocabulary:`, ...)
 * still throw from the underlying `loadWorkspace` call.
 */
export interface LoadWorkspaceResult {
  workspace: Workspace;
  diagnostics: Diagnostic[];
}

/**
 * Companion to `loadWorkspace` that surfaces non-fatal manifest-shape
 * diagnostics through a return value instead of throwing. CLI/MCP entry
 * points and the R02 test fixture harness use this to fold loader
 * diagnostics into their normal output path.
 *
 * Specifically: when `rules.io_modules` contains a string that fails to
 * compile as a `RegExp`, the offending entry is REMOVED from the in-memory
 * workspace and a `CHEM-MANIFEST-005` diagnostic is appended. By the time
 * `checkImports` reads `ws.rules?.io_modules`, every survivor is guaranteed
 * to compile.
 */
export function loadWorkspaceWithDiagnostics(workspacePath: string): LoadWorkspaceResult {
  const workspace = loadWorkspace(workspacePath);
  const diagnostics: Diagnostic[] = [];

  const raw = workspace.rules?.io_modules;
  if (Array.isArray(raw) && raw.length > 0) {
    const kept: string[] = [];
    for (const pattern of raw) {
      // Defensive: a YAML payload could put non-strings in the array.
      if (typeof pattern !== "string") {
        diagnostics.push({
          level: "error",
          check: "manifest-io-modules",
          code: "CHEM-MANIFEST-005",
          message: tr("diagnostic.invalid_io_module_pattern", {
            pattern: String(pattern),
            error: "expected a string regex source",
          }),
          file: workspacePath,
        });
        continue;
      }
      try {
        // Validate by compilation only; the analyze phase re-compiles via
        // `compileIoModulePatterns` for purity.
        new RegExp(pattern);
        kept.push(pattern);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        diagnostics.push({
          level: "error",
          check: "manifest-io-modules",
          code: "CHEM-MANIFEST-005",
          message: tr("diagnostic.invalid_io_module_pattern", {
            pattern,
            error: msg,
          }),
          file: workspacePath,
        });
      }
    }
    // Mutate in place — the workspace shape is preserved, only the offending
    // entries are pruned.
    if (workspace.rules) {
      workspace.rules.io_modules = kept;
    }
  }

  return { workspace, diagnostics };
}

export function loadWorkspace(workspacePath: string): Workspace {
  const content = fs.readFileSync(workspacePath, "utf-8");
  const ws = parseYaml(content) as Workspace;

  if (!ws.workspace) {
    throw new Error(`Missing "workspace" field in ${workspacePath}`);
  }
  if (!ws.roles || Object.keys(ws.roles).length === 0) {
    throw new Error(`Missing or empty "roles" field in ${workspacePath}`);
  }
  if (!ws.bonds) {
    throw new Error(`Missing "bonds" field in ${workspacePath}`);
  }

  // ---------------------------------------------------------------------
  // Multi-language vs legacy single-language normalization (wp-019).
  //
  // Authority on input is `languages:` when present. The legacy `language`
  // and `paths` fields are then DERIVED projections of `languages[0]` so
  // single-plugin call sites (`loadPlugin({ language: ws.language })`,
  // `discoverCompounds` consumers that read `ws.paths`) keep working.
  //
  // Conversely, when only the legacy form is supplied we synthesize a
  // one-element `languages` array with id "default" so downstream code
  // can iterate uniformly.
  // ---------------------------------------------------------------------
  if (Array.isArray(ws.languages) && ws.languages.length > 0) {
    // Multi-language branch — validate the array, then derive legacy fields.
    for (let i = 0; i < ws.languages.length; i++) {
      const sub = ws.languages[i];
      if (!sub || typeof sub !== "object") {
        throw new Error(`languages[${i}] is not an object in ${workspacePath}`);
      }
      if (!sub.id || typeof sub.id !== "string") {
        throw new Error(`Missing "languages[${i}].id" field in ${workspacePath}`);
      }
      if (!sub.language || typeof sub.language !== "string") {
        throw new Error(`Missing "languages[${i}].language" field in ${workspacePath}`);
      }
      if (!sub.paths || typeof sub.paths !== "object") {
        throw new Error(`Missing "languages[${i}].paths" object in ${workspacePath}`);
      }
      if (!sub.paths.compounds) {
        throw new Error(`Missing "languages[${i}].paths.compounds" field in ${workspacePath}`);
      }
    }

    const primary = ws.languages[0];
    // Derived projections — input authority remains on `languages`.
    ws.language = primary.language;
    ws.paths = primary.paths;
  } else {
    // Legacy single-language branch — validate the legacy `paths` block ONLY
    // here so multi-language workspaces aren't tripped by it.
    if (!ws.paths?.compounds) {
      throw new Error(`Missing "paths.compounds" field in ${workspacePath}`);
    }
    if (!ws.language || typeof ws.language !== "string") {
      throw new Error(`Missing "language" field in ${workspacePath}`);
    }

    // Synthesize a one-element languages array so downstream code can iterate.
    const synthesized: LanguageSubtree = {
      id: "default",
      language: ws.language,
      paths: ws.paths,
    };
    ws.languages = [synthesized];
  }

  // Optional vocabulary field — validate against the known VocabularyName set.
  if (ws.vocabulary !== undefined) {
    if (ws.vocabulary !== "standard" && ws.vocabulary !== "chemistry") {
      throw new Error(
        `Invalid "vocabulary" field in ${workspacePath}: ` +
          `expected "standard" or "chemistry", got "${String(ws.vocabulary)}"`,
      );
    }
  }

  return ws;
}

/**
 * Optional hook used by the cache layer to interpose on the per-compound
 * load step. When provided, `discoverCompounds` consults
 * `hooks.loadCompound` for every candidate manifest path it finds. The
 * default implementation reads + parses the YAML directly.
 */
export interface DiscoverCompoundsHooks {
  loadCompound?: (manifestPath: string) => LoadedCompound;
}

export function discoverCompounds(
  workspace: Workspace,
  workspaceDir: string,
  hooks: DiscoverCompoundsHooks = {},
): LoadedCompound[] {
  // Flatten the per-sub-tree result for legacy callers. Order matches
  // discoverCompoundsBySubtree's sub-tree iteration order.
  const grouped = discoverCompoundsBySubtree(workspace, workspaceDir, hooks);
  return grouped.flatMap((g) => g.compounds);
}

/**
 * Per-sub-tree variant of `discoverCompounds`. Returns one entry per
 * `workspace.languages[]` entry (or a single "default" entry for legacy
 * single-language workspaces), each carrying the matched `LanguageSubtree`
 * and the compounds discovered under that sub-tree's path roots.
 *
 * This is the entry point wp-020 orchestrators (check / analyze / scaffold
 * / sync / graph) use to build `ImportCheckScope[]`.
 */
export function discoverCompoundsBySubtree(
  workspace: Workspace,
  workspaceDir: string,
  hooks: DiscoverCompoundsHooks = {},
): { scope: LanguageSubtree; compounds: LoadedCompound[] }[] {
  const manifestFilename = workspace.rules?.manifest_filename ?? "compound.yaml";
  const load = hooks.loadCompound ?? loadCompound;

  // Iterate every sub-tree. The loader guarantees `workspace.languages`
  // is non-empty after normalization (legacy workspaces are synthesized
  // into a single "default" sub-tree).
  const subtrees: LanguageSubtree[] = workspace.languages ?? [
    {
      id: "default",
      language: workspace.language,
      paths: workspace.paths,
    },
  ];

  return subtrees.map((sub) => {
    const compounds: LoadedCompound[] = [];

    // Standard compound directories (each subdirectory is a compound)
    const scanDirs: string[] = [sub.paths.compounds];
    if (sub.paths.reagents) scanDirs.push(sub.paths.reagents);
    if (sub.paths.solvents) scanDirs.push(sub.paths.solvents);

    for (const rel of scanDirs) {
      const absDir = path.resolve(workspaceDir, rel);
      if (!fs.existsSync(absDir)) continue;

      const entries = fs.readdirSync(absDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(absDir, entry.name, manifestFilename);
        if (fs.existsSync(manifestPath)) {
          compounds.push(load(manifestPath));
        }
      }
    }

    // Catalyst is a single directory, not a parent of compound subdirectories
    if (sub.paths.catalyst) {
      const catalystDir = path.resolve(workspaceDir, sub.paths.catalyst);
      const manifestPath = path.join(catalystDir, manifestFilename);
      if (fs.existsSync(manifestPath)) {
        compounds.push(load(manifestPath));
      }
    }

    return { scope: sub, compounds };
  });
}

/**
 * Default loader for a single compound manifest. Exported so the CLI cache
 * layer can wrap it (read once, hash, decide to use cache or fall through
 * to this implementation). No public surface change for non-cache callers
 * — they continue to call `discoverCompounds` and never see this.
 */
export function loadCompound(manifestPath: string): LoadedCompound {
  const content = fs.readFileSync(manifestPath, "utf-8");
  const manifest = parseYaml(content) as Compound;

  if (!manifest.compound) {
    throw new Error(`Missing "compound" field in ${manifestPath}`);
  }

  return { manifest, dir: path.dirname(manifestPath) };
}
