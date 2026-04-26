import type { DiagnosticCode } from "./diagnostics/codes.js";

// ---------------------------------------------------------------------------
// Workspace (workspace.yaml)
// ---------------------------------------------------------------------------

/** Names of the locales shipped with the toolkit. */
export type VocabularyName = "standard" | "chemistry";

export interface Workspace {
  workspace: string;
  language: string;
  roles: Record<string, RoleDefinition>;
  bonds: Record<string, string[]>;
  compound_types?: Record<string, CompoundTypeDefinition>;
  signals?: WorkspaceSignals;
  paths: WorkspacePaths;
  rules?: WorkspaceRules;
  /** Optional locale for diagnostic and CLAUDE.md output. */
  vocabulary?: VocabularyName;
}

export interface RoleDefinition {
  description: string;
  folder: string;
}

export interface CompoundTypeDefinition {
  description: string;
  importable_by?: "all" | "none" | "same_type";
  can_import?: string[];
  implicit?: boolean;
  singleton?: boolean;
  allowed_roles?: string[];
}

export interface WorkspaceSignals {
  naming?: "dot_separated" | "slash_separated" | "free";
  registry?: WorkspaceSignalEntry[];
}

export interface WorkspaceSignalEntry {
  name: string;
  description?: string;
  payload?: string;
}

export interface WorkspacePaths {
  compounds: string;
  reagents?: string;
  solvents?: string;
  catalyst?: string;
}

export interface WorkspaceRules {
  cross_compound_imports?: "public_only" | "unrestricted";
  role_from_path?: boolean;
  public_surface?: string;
  manifest_filename?: string;
  python_packages?: string[];
}

// ---------------------------------------------------------------------------
// Compound (compound.yaml)
// ---------------------------------------------------------------------------

export interface Compound {
  compound: string;
  type?: "compound" | "reagent" | "solvent" | "catalyst";
  description?: string;
  exports?: Record<string, string[]>;
  imports?: ImportDeclaration[];
  units?: UnitDeclaration[];
  signals?: CompoundSignals;
  assays?: AssayDeclaration[];
  wiring?: WiringDeclaration[];
}

export interface ImportDeclaration {
  compound: string;
  units?: string[];
}

export interface UnitDeclaration {
  role: string;
  name: string;
  file: string;
  depends_on?: string[];
  implements?: string[];
  wraps?: string[];
  emits?: string[];
}

export interface CompoundSignals {
  emits?: SignalEmission[];
  listens?: SignalListener[];
}

export interface SignalEmission {
  signal: string;
  emitted_by?: string;
  payload?: string;
}

export interface SignalListener {
  signal: string;
  handler: string;
}

export interface AssayDeclaration {
  name: string;
  file: string;
  subjects?: string[];
  mocks?: string[];
}

export interface WiringDeclaration {
  interface: string;
  adapter: string;
  compound: string;
  profile?: string;
}

// ---------------------------------------------------------------------------
// Checker internals
// ---------------------------------------------------------------------------

export interface LoadedCompound {
  manifest: Compound;
  dir: string;
}

export interface Diagnostic {
  level: "error" | "warning";
  check: string;
  /**
   * Stable diagnostic code (CHEM-CATEGORY-NNN). Bijective with the
   * `diagnostic.*` TrKey emitted as the message. See
   * `./diagnostics/codes.ts` for the registry.
   */
  code: DiagnosticCode;
  compound?: string;
  message: string;
  hint?: string;
  /**
   * Optional structured remediation hint for AI agents and tooling. The
   * `kind` discriminator drives which extra fields are populated.
   * Populated by `check-edit` for diagnostics where a fix is mechanically
   * derivable; left undefined elsewhere.
   */
  remediation?: DiagnosticRemediation;
}

/**
 * Discriminated union of structured remediation hints. Consumers (AI
 * agents, MCP tools, IDE extensions) switch on `kind` to map a
 * diagnostic to a concrete fix.
 */
export type DiagnosticRemediation =
  | { kind: "use_interface"; interface_candidates: string[] }
  | { kind: "move_to_compound"; compound_candidates: string[] }
  | { kind: "move_to_role_folder"; expected_folder: string }
  | { kind: "import_via_public_surface"; surface: string; target_compound: string }
  | { kind: "add_compound_import"; target_compound: string };

export type { DiagnosticCode } from "./diagnostics/codes.js";

export type CheckFn = (
  workspace: Workspace,
  compounds: LoadedCompound[],
  options: CheckOptions,
) => Diagnostic[];

export interface CheckOptions {
  manifestOnly: boolean;
  defaultPublicSurface?: string;
}

// ---------------------------------------------------------------------------
// Language plugin types
// ---------------------------------------------------------------------------

/** A single import statement parsed from a source file. */
export interface ParsedImport {
  moduleSpecifier: string;
  names: string[];
  isTypeOnly: boolean;
}

/** An import resolved to a specific compound and unit. */
export interface ResolvedImport {
  fromCompound: string;
  fromUnit: string;
  names: string[];
  isTypeOnly: boolean;
}

/** A unit inferred from scanning source files on disk. */
export interface InferredUnit {
  name: string;
  role: string;
  fileName: string;
  exports: string[];
  implements?: string;
}
