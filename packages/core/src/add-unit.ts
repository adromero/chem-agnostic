// ---------------------------------------------------------------------------
// `addUnitToCompound` — language-agnostic, pure-library helper that wraps the
// `compound.yaml` Document-API mutation previously inlined in
// `packages/cli/src/commands/add.ts::addUnit`.
//
// Hoisted into @chemag/core (wp-015) so both the CLI and the `scaffold_unit`
// MCP tool can call it without a @chemag/mcp-server -> @chemag/cli cycle.
//
// Design contract:
//   * No `process.exit`, no `console.*`. Errors are typed exceptions; the
//     caller maps them to its own surface (CLI exit code, MCP error response,
//     etc.).
//   * Byte-for-byte equivalent to the previous inline mutation: we use
//     `parseDocument` / `doc.set` / `doc.createNode` exactly as the CLI does
//     today so the manifest output is preserved (stable indentation, comment
//     fidelity, etc.).
//   * Diff computation lives at the consumer layer — keeps `@chemag/core`
//     free of the `diff` dep.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { parseDocument } from "yaml";
import { discoverCompounds } from "./loader.js";
import type { LanguagePlugin } from "./plugin-interface.js";
import { scaffoldWorkspace } from "./scaffold.js";
import type { Workspace } from "./types.js";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Options for `addUnitToCompound`. */
export interface AddUnitOptions {
  /** Pre-parsed workspace.yaml. */
  workspace: Workspace;
  /** Absolute directory the workspace.yaml lives in. */
  workspaceDir: string;
  /** Compound name (must already exist). */
  compoundName: string;
  /** Role name — must be a key of `workspace.roles`. */
  role: string;
  /** Unit name to add. */
  unitName: string;
  /** Add to the compound's exports list under the role's plural key. */
  export?: boolean;
  /** Optional `implements` symbol (only meaningful for the adapter role). */
  implementsSymbol?: string;
  /** Active language plugin (used for filename + scaffold generation). */
  plugin: LanguagePlugin;
  /**
   * When true the helper computes the patched manifest in memory only and
   * does NOT write it to disk; `created` and `skipped` are empty arrays.
   */
  dryRun?: boolean;
}

/** Result of a successful `addUnitToCompound` invocation. */
export interface AddUnitResult {
  /** Absolute path to the patched compound.yaml. */
  manifestPath: string;
  /** Manifest YAML before the mutation (file contents on disk). */
  manifestBefore: string;
  /** Manifest YAML after the mutation (in-memory result). */
  manifestAfter: string;
  /** Files written by the subsequent scaffold pass. Empty when dryRun. */
  created: string[];
  /** Files that already existed and were left alone. Empty when dryRun. */
  skipped: string[];
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Base class — discriminator for the union below. */
export class AddUnitError extends Error {
  readonly kind: AddUnitErrorKind;
  constructor(kind: AddUnitErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "AddUnitError";
  }
}

export type AddUnitErrorKind = "unknown_role" | "compound_not_found" | "duplicate_unit";

/** Thrown when `opts.role` is not declared in `workspace.roles`. */
export class UnknownRoleError extends AddUnitError {
  readonly role: string;
  readonly knownRoles: string[];
  constructor(role: string, knownRoles: string[]) {
    super("unknown_role", `Unknown role "${role}". Known roles: [${knownRoles.join(", ")}]`);
    this.role = role;
    this.knownRoles = knownRoles;
    this.name = "UnknownRoleError";
  }
}

/** Thrown when the compound doesn't exist under the configured roots. */
export class CompoundNotFoundError extends AddUnitError {
  readonly compoundName: string;
  constructor(compoundName: string) {
    super("compound_not_found", `Compound "${compoundName}" not found.`);
    this.compoundName = compoundName;
    this.name = "CompoundNotFoundError";
  }
}

/** Thrown when a unit with the same name already exists in the compound. */
export class DuplicateUnitError extends AddUnitError {
  readonly compoundName: string;
  readonly unitName: string;
  constructor(compoundName: string, unitName: string) {
    super("duplicate_unit", `Unit "${unitName}" already exists in compound "${compoundName}".`);
    this.compoundName = compoundName;
    this.unitName = unitName;
    this.name = "DuplicateUnitError";
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Patch a compound's `compound.yaml` to add a new unit declaration and,
 * optionally, expose it via the compound's public surface. On success and
 * when `dryRun !== true`, runs `scaffoldWorkspace` to generate the stub
 * file(s) for the new unit and returns the list of created/skipped paths.
 *
 * Throws one of `UnknownRoleError`, `CompoundNotFoundError`,
 * `DuplicateUnitError` for the corresponding precondition violations.
 *
 * Pure library code: no `process.exit`, no `console.*`. The caller decides
 * how to surface errors.
 */
export function addUnitToCompound(opts: AddUnitOptions): AddUnitResult {
  const {
    workspace,
    workspaceDir,
    compoundName,
    role,
    unitName,
    plugin,
    export: shouldExport = false,
    implementsSymbol,
    dryRun = false,
  } = opts;

  // 1. Validate role.
  if (!workspace.roles[role]) {
    throw new UnknownRoleError(role, Object.keys(workspace.roles));
  }

  // 2. Locate compound.
  const compounds = discoverCompounds(workspace, workspaceDir);
  const target = compounds.find((c) => c.manifest.compound === compoundName);
  if (!target) {
    throw new CompoundNotFoundError(compoundName);
  }

  // 3. Refuse duplicates.
  const existing = (target.manifest.units ?? []).find((u) => u.name === unitName);
  if (existing) {
    throw new DuplicateUnitError(compoundName, unitName);
  }

  // 4. Compute the unit's relative file path via the plugin.
  const folder = workspace.roles[role].folder;
  const file = `./${plugin.unitFilePath(role, unitName, folder)}`;

  // 5. Patch the manifest using the YAML Document API (preserves byte
  //    output the same way the CLI does today).
  const manifestFile = workspace.rules?.manifest_filename ?? "compound.yaml";
  const manifestPath = path.join(target.dir, manifestFile);
  const manifestBefore = fs.readFileSync(manifestPath, "utf-8");
  const doc = parseDocument(manifestBefore);

  const unitEntry: Record<string, unknown> = { role, name: unitName, file };
  if (implementsSymbol) unitEntry.implements = [implementsSymbol];

  // Ensure `units:` exists as a sequence, then append.
  // The `yaml` Document API exposes `set`/`createNode`/sequence-`add` only via
  // structural access; cast through `unknown` to a minimal shape we control.
  let units = doc.get("units") as { items?: unknown[]; add: (n: unknown) => void } | undefined;
  if (!units || !Array.isArray(units.items)) {
    doc.set("units", []);
    units = doc.get("units") as { items?: unknown[]; add: (n: unknown) => void };
  }
  units.add(doc.createNode(unitEntry));

  // Optionally append to exports[<role>s]:.
  if (shouldExport) {
    const pluralRole = `${role}s`;
    type YamlMap = {
      get: (k: string) => { add: (n: unknown) => void } | undefined;
      set: (k: string, v: unknown) => void;
    };
    let exports = doc.get("exports") as YamlMap | undefined;
    if (!exports) {
      doc.set("exports", {});
      exports = doc.get("exports") as YamlMap;
    }
    const roleExports = exports.get(pluralRole);
    if (!roleExports) {
      exports.set(pluralRole, doc.createNode([unitName]));
    } else {
      roleExports.add(doc.createNode(unitName));
    }
  }

  const manifestAfter = doc.toString();

  // 6. Dry run? Return the in-memory diff and stop.
  if (dryRun) {
    return {
      manifestPath,
      manifestBefore,
      manifestAfter,
      created: [],
      skipped: [],
    };
  }

  // 7. Persist the manifest, then scaffold from the reloaded compound list.
  fs.writeFileSync(manifestPath, manifestAfter, "utf-8");

  const reloaded = discoverCompounds(workspace, workspaceDir);
  const result = scaffoldWorkspace(workspace, reloaded, plugin, false);

  return {
    manifestPath,
    manifestBefore,
    manifestAfter,
    created: result.created,
    skipped: result.skipped,
  };
}
