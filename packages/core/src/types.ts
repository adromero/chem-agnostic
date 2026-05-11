import type { DiagnosticCode } from "./diagnostics/codes.js";

// ---------------------------------------------------------------------------
// Workspace (workspace.yaml)
// ---------------------------------------------------------------------------

/** Names of the locales shipped with the toolkit. */
export type VocabularyName = "standard" | "chemistry";

export interface Workspace {
  workspace: string;
  /**
   * Primary language for the workspace. For legacy single-language workspaces
   * this is the authoritative input. For multi-language workspaces (those
   * declaring `languages:`) this is a DERIVED field — populated by the loader
   * from `languages[0].language` so existing single-plugin call sites
   * (`loadPlugin({ language: ws.language })`) keep working without changes.
   * Always non-null after loader normalization.
   */
  language: string;
  roles: Record<string, RoleDefinition>;
  bonds: Record<string, string[]>;
  compound_types?: Record<string, CompoundTypeDefinition>;
  signals?: WorkspaceSignals;
  /**
   * Top-level paths block. For legacy single-language workspaces this is the
   * authoritative input. For multi-language workspaces this is a DERIVED field
   * — populated by the loader from `languages[0].paths`. Always populated
   * after loader normalization.
   */
  paths: WorkspacePaths;
  rules?: WorkspaceRules;
  /** Optional locale for diagnostic and CLAUDE.md output. */
  vocabulary?: VocabularyName;
  /**
   * Per-language sub-trees. The loader guarantees this is a non-empty array
   * after normalization: legacy single-language workspaces are synthesized
   * into a one-element array with id "default"; multi-language workspaces
   * declare it explicitly. WP-019 minimal wiring — full per-sub-tree plugin
   * orchestration arrives in WP-020.
   */
  languages?: LanguageSubtree[];
}

/**
 * One language sub-tree within a multi-language workspace. Each sub-tree owns
 * its own root paths, language, and language-specific options. The optional
 * `allowed_cross_language_imports` field is reserved for WP-020's enforcement.
 */
export interface LanguageSubtree {
  /** Unique identifier for this sub-tree within the workspace. */
  id: string;
  /** Plugin language ("typescript" | "python" | ...). */
  language: string;
  /** Per-sub-tree role-folder roots. */
  paths: WorkspacePaths;
  /** Optional override of the workspace-wide public surface filename. */
  public_surface?: string;
  /** Python: importable package roots used by the python plugin. */
  python_packages?: string[];
  /** Go: module root passed to the future Go plugin. */
  go_module_root?: string;
  /** Sub-tree ids this sub-tree may import from across the language boundary. */
  allowed_cross_language_imports?: string[];
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
  /**
   * Optional list of regex source strings appended to the default I/O-module
   * allowlist used by `CHEM-PORT-001`. Validated and compiled by the loader;
   * invalid patterns are pruned and surface as `CHEM-MANIFEST-005` diagnostics
   * at workspace-load time (never thrown).
   */
  io_modules?: string[];
  /**
   * Optional list of class names exempt from `CHEM-PORT-003` (concrete
   * cross-compound class imports). EXTENDS the default allowlist
   * `["Date", "URL", "Money", "RegExp"]` — entries supplement, never replace.
   * Matching is literal and case-sensitive.
   */
  import_class_allowlist?: string[];
  /**
   * Threshold for `CHEM-DRY-001` (function duplicated across N+ non-test
   * files). Default 3. Names that appear in fewer than this many distinct
   * files do not fire the rule.
   */
  duplicate_function_threshold?: number;
  /**
   * List of top-level function names that are EXEMPT from `CHEM-DRY-001`.
   * REPLACES the default exclude list `["setup", "teardown", "beforeEach",
   * "afterEach"]` — entries here supplant the defaults rather than extend
   * them (typical configuration semantics: if you set the field, you own
   * the full list).
   */
  duplicate_function_exclude?: string[];
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
  level: "error" | "warning" | "suggestion";
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
  // ------------------------------------------------------------------- //
  // Optional location fields (added in wp-005). Populated for source-level
  // diagnostics (import-check, check-edit) and any manifest-level check that
  // can pinpoint a single file. Workspace-level diagnostics leave them
  // undefined — SARIF then renders them as workspace-level findings.
  // line/column are deferred until the language-plugin contract surfaces
  // import positions; the fields exist now so the public Diagnostic shape
  // is stable.
  // ------------------------------------------------------------------- //
  /** Absolute or workspace-relative path to the file the diagnostic concerns. */
  file?: string;
  /** 1-based line number within `file`. Undefined if not known. */
  line?: number;
  /** 1-based column number within `file`. Undefined if not known. */
  column?: number;
  /**
   * Sub-tree id (from `Workspace.languages[].id`) the diagnostic was emitted
   * against. Populated by per-sub-tree orchestrators (wp-020) — left undefined
   * for legacy single-language workspaces and for workspace-level checks that
   * do not bind to a single sub-tree.
   */
  language_id?: string;
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

/**
 * Resolution outcome for an imported symbol's final declaration.
 * Populated by language plugins that can perform symbol resolution
 * (TypeScript via ts-morph); left undefined by plugins that cannot
 * (Python). Used by CHEM-PORT-003 and any future rule that needs to
 * distinguish "this import resolves to a class" from "this import
 * resolves to an interface/type/function".
 */
export type DeclarationKind = "class" | "interface" | "type" | "function" | "value" | "unresolved";

/** A single import statement parsed from a source file. */
export interface ParsedImport {
  moduleSpecifier: string;
  names: string[];
  isTypeOnly: boolean;
  /**
   * Final-declaration kind of the imported symbol after following any
   * number of `export { X } from "..."` re-export chains (depth cap 5).
   * Undefined when the plugin cannot resolve symbols (Python) or when
   * resolution failed / was skipped. Per-statement, not per-name — for
   * multi-name imports the kind reflects the first resolvable name.
   */
  declarationKind?: DeclarationKind;
}

/**
 * A single `new X(...)` call site discovered by a language plugin's
 * `scanNewExpressions` method. Carries ONLY AST-extractable facts — the
 * plugin must NOT consult workspace data when populating this struct.
 *
 * Consumed by `checkPortAdapterInstantiation` (CHEM-PORT-004), which maps
 * the call site and constructor-declaration file to compounds/roles using
 * the workspace-side `fileIndex` and `compoundMap`.
 */
export interface NewExpressionSite {
  /** Absolute path of the file containing the `new` expression. */
  callerAbsPath: string;
  /** Identifier text used in `new X(...)` (e.g. "StripeGateway"). */
  className: string;
  /**
   * Absolute path of the file declaring the class, after walking
   * `getAliasedSymbol()` chains up to ALIAS_DEPTH_CAP. `undefined` when
   * the plugin could not resolve the constructor symbol (treat as skip).
   */
  constructorDeclAbsPath: string | undefined;
  /**
   * `true` iff the class declaration is preceded by a `// @chemag-transient`
   * single-line comment in its leading trivia. Matched as a substring of
   * the trimmed comment text — DO NOT interpret as a JSDoc tag.
   */
  isTransient: boolean;
}

/**
 * A single top-level `function` declaration discovered by a language plugin's
 * `scanFunctionDeclarations` method. Carries ONLY AST-extractable facts — the
 * plugin must NOT consult workspace state when populating this struct.
 *
 * Consumed by `checkDuplicatedFunction` (CHEM-DRY-001), which aggregates
 * declarations by name across non-test files and emits a suggestion when a
 * name appears in N or more files.
 */
export interface FunctionDeclarationSite {
  /** Identifier text of the declared function (e.g. "fieldErrorsFromZod"). */
  functionName: string;
  /** Absolute path of the file containing the declaration. */
  absPath: string;
  /** 1-based line number of the `function` keyword. Optional. */
  line?: number;
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
