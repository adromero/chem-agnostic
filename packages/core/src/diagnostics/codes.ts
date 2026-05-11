// ---------------------------------------------------------------------------
// Diagnostic code registry — stable forever in v1.x.
//
// Format: CHEM-<CATEGORY>-<NNN>
// Cardinality: ONE CODE PER `diagnostic.*` TrKey. The `DIAGNOSTIC_CODES` map
// is the bijection between codes and trKeys; the registry-test in
// `test/diagnostics-registry.test.ts` enforces it at CI time.
//
// Numbering policy: each category is partitioned into 100-wide BLOCKS.
//   * 001..099 — primary block (runtime-emitted diagnostics, the default).
//   * 101..199 — second block (e.g., MCP tool-protocol errors that are
//     surfaced through MCP responses rather than CLI runs).
//   * 201..299 — third block (MCP-client-registration diagnostics, surfaced
//     through chemag mcp install/uninstall/status).
//   * 301..399 — fourth block (MCP resource-read diagnostics, surfaced
//     through resource reads/subscriptions on the MCP server).
// Within a block the numbering is contiguous: 001, 002, 003, ..., or
// 101, 102, 103, .... Gaps WITHIN a block are permitted only when a code
// has been deprecated (mark the entry with `deprecated: { since, replacement }`);
// new, non-deprecated codes never reuse a deprecated number — they take the
// next free integer in their block.
// ---------------------------------------------------------------------------
import type { TrKey } from "../vocabulary/keys.js";

/** All categories codes can belong to. */
export type DiagnosticCategory =
  | "MANIFEST"
  | "BOND"
  | "IMPORT"
  | "IMPORT-CROSS-LANG"
  | "EXPORT"
  | "WIRING"
  | "SIGNAL"
  | "ASSAY"
  | "TYPE"
  | "PUBLIC"
  | "ROLE"
  | "PLACEMENT"
  | "EMIT-RULES"
  | "MCP"
  | "INSTALL-HOOKS"
  | "PORT"
  | "DRY";

/**
 * String-literal union of every emitted diagnostic code. Adding a new code
 * means extending this union and adding a matching entry to
 * `DIAGNOSTIC_CODES` below — both are checked by the registry-test.
 */
export type DiagnosticCode =
  // ---- MANIFEST ----
  | "CHEM-MANIFEST-001"
  | "CHEM-MANIFEST-002"
  | "CHEM-MANIFEST-003"
  | "CHEM-MANIFEST-004"
  | "CHEM-MANIFEST-005"
  // ---- PORT ----
  // NOTE: CHEM-PORT-002 is RESERVED (Tier 3, see proposed-rules.md) — no entry.
  | "CHEM-PORT-001"
  | "CHEM-PORT-003"
  | "CHEM-PORT-004"
  // ---- DRY ----
  | "CHEM-DRY-001"
  // ---- ROLE ----
  | "CHEM-ROLE-001"
  | "CHEM-ROLE-002"
  // ---- PLACEMENT ----
  | "CHEM-PLACEMENT-001"
  | "CHEM-PLACEMENT-002"
  | "CHEM-PLACEMENT-003"
  | "CHEM-PLACEMENT-004"
  // ---- PUBLIC ----
  | "CHEM-PUBLIC-001"
  // ---- EXPORT ----
  | "CHEM-EXPORT-001"
  // ---- IMPORT ----
  | "CHEM-IMPORT-001"
  | "CHEM-IMPORT-002"
  | "CHEM-IMPORT-003"
  | "CHEM-IMPORT-004"
  // ---- IMPORT-CROSS-LANG ----
  | "CHEM-IMPORT-CROSS-LANG-001"
  // ---- TYPE ----
  | "CHEM-TYPE-001"
  | "CHEM-TYPE-002"
  | "CHEM-TYPE-003"
  // ---- BOND ----
  | "CHEM-BOND-001"
  | "CHEM-BOND-002"
  | "CHEM-BOND-003"
  // ---- SIGNAL ----
  | "CHEM-SIGNAL-001"
  | "CHEM-SIGNAL-002"
  | "CHEM-SIGNAL-003"
  // ---- WIRING ----
  | "CHEM-WIRING-001"
  | "CHEM-WIRING-002"
  | "CHEM-WIRING-003"
  | "CHEM-WIRING-004"
  // ---- ASSAY ----
  | "CHEM-ASSAY-001"
  | "CHEM-ASSAY-002"
  // ---- EMIT-RULES ----
  | "CHEM-EMIT-RULES-001"
  | "CHEM-EMIT-RULES-002"
  | "CHEM-EMIT-RULES-003"
  // ---- MCP ----
  | "CHEM-MCP-001"
  | "CHEM-MCP-002"
  | "CHEM-MCP-003"
  | "CHEM-MCP-101"
  | "CHEM-MCP-102"
  | "CHEM-MCP-103"
  | "CHEM-MCP-201"
  | "CHEM-MCP-202"
  | "CHEM-MCP-203"
  | "CHEM-MCP-301"
  | "CHEM-MCP-302"
  | "CHEM-MCP-303"
  // ---- INSTALL-HOOKS ----
  | "CHEM-INSTALL-HOOKS-001"
  | "CHEM-INSTALL-HOOKS-002"
  | "CHEM-INSTALL-HOOKS-003"
  | "CHEM-INSTALL-HOOKS-004"
  | "CHEM-INSTALL-HOOKS-005"
  | "CHEM-INSTALL-HOOKS-006"
  | "CHEM-INSTALL-HOOKS-007"
  | "CHEM-INSTALL-HOOKS-008"
  | "CHEM-INSTALL-HOOKS-009"
  | "CHEM-INSTALL-HOOKS-010";

/** Subset of `TrKey` containing only `diagnostic.*` keys. */
export type DiagnosticTrKey = Extract<TrKey, `diagnostic.${string}`>;

/** Metadata for a single diagnostic code. */
export interface DiagnosticCodeMeta {
  code: DiagnosticCode;
  category: DiagnosticCategory;
  level: "error" | "warning" | "suggestion";
  /** The TrKey emitted alongside this code. Must be a `diagnostic.*` member. */
  trKey: DiagnosticTrKey;
  /** Section anchor in the docs site (rendered as `#<helpFragment>`). */
  helpFragment: string;
  /** Mark a code deprecated; `replacement` points at the surviving code. */
  deprecated?: { since: string; replacement?: DiagnosticCode };
}

/**
 * The bijection. Every `diagnostic.*` TrKey gets exactly one code; every code
 * gets exactly one trKey. The registry-test (`diagnostics-registry.test.ts`)
 * enforces this invariant against the full `ALL_TR_KEYS` set.
 */
export const DIAGNOSTIC_CODES: Record<DiagnosticCode, DiagnosticCodeMeta> = {
  // ---- MANIFEST ----
  "CHEM-MANIFEST-001": {
    code: "CHEM-MANIFEST-001",
    category: "MANIFEST",
    level: "error",
    trKey: "diagnostic.duplicate_compound",
    helpFragment: "chem-manifest-001-duplicate-compound",
  },
  "CHEM-MANIFEST-002": {
    code: "CHEM-MANIFEST-002",
    category: "MANIFEST",
    level: "error",
    trKey: "diagnostic.singleton_violated",
    helpFragment: "chem-manifest-002-singleton-violated",
  },
  "CHEM-MANIFEST-003": {
    code: "CHEM-MANIFEST-003",
    category: "MANIFEST",
    level: "error",
    trKey: "diagnostic.subtree_paths_overlap",
    helpFragment: "chem-manifest-003-subtree-paths-overlap",
  },
  "CHEM-MANIFEST-004": {
    code: "CHEM-MANIFEST-004",
    category: "MANIFEST",
    level: "error",
    trKey: "diagnostic.subtree_id_duplicate",
    helpFragment: "chem-manifest-004-subtree-id-duplicate",
  },
  "CHEM-MANIFEST-005": {
    code: "CHEM-MANIFEST-005",
    category: "MANIFEST",
    level: "error",
    trKey: "diagnostic.invalid_io_module_pattern",
    helpFragment: "chem-manifest-005-invalid-io-module-pattern",
  },

  // ---- PORT ----
  // CHEM-PORT-002 is intentionally not registered — RESERVED (Tier 3).
  "CHEM-PORT-001": {
    code: "CHEM-PORT-001",
    category: "PORT",
    level: "warning",
    trKey: "diagnostic.port_needs_interface",
    helpFragment: "chem-port-001-port-needs-interface",
  },
  "CHEM-PORT-003": {
    code: "CHEM-PORT-003",
    category: "PORT",
    level: "error",
    trKey: "diagnostic.port_class_cross_compound",
    helpFragment: "chem-port-003-port-class-cross-compound",
  },
  "CHEM-PORT-004": {
    code: "CHEM-PORT-004",
    category: "PORT",
    level: "error",
    trKey: "diagnostic.port.adapter_instantiation",
    helpFragment: "chem-port-004-port-adapter-instantiation",
  },

  // ---- DRY ----
  "CHEM-DRY-001": {
    code: "CHEM-DRY-001",
    category: "DRY",
    level: "suggestion",
    trKey: "diagnostic.dry.function_duplicated",
    helpFragment: "chem-dry-001-function-duplicated",
  },

  // ---- ROLE ----
  "CHEM-ROLE-001": {
    code: "CHEM-ROLE-001",
    category: "ROLE",
    level: "error",
    trKey: "diagnostic.unknown_role",
    helpFragment: "chem-role-001-unknown-role",
  },
  "CHEM-ROLE-002": {
    code: "CHEM-ROLE-002",
    category: "ROLE",
    level: "error",
    trKey: "diagnostic.role_not_allowed_for_type",
    helpFragment: "chem-role-002-role-not-allowed-for-type",
  },

  // ---- PLACEMENT ----
  "CHEM-PLACEMENT-001": {
    code: "CHEM-PLACEMENT-001",
    category: "PLACEMENT",
    level: "error",
    trKey: "diagnostic.file_missing_unit",
    helpFragment: "chem-placement-001-file-missing-unit",
  },
  "CHEM-PLACEMENT-002": {
    code: "CHEM-PLACEMENT-002",
    category: "PLACEMENT",
    level: "error",
    trKey: "diagnostic.file_missing_assay",
    helpFragment: "chem-placement-002-file-missing-assay",
  },
  "CHEM-PLACEMENT-003": {
    code: "CHEM-PLACEMENT-003",
    category: "PLACEMENT",
    level: "error",
    trKey: "diagnostic.role_folder_mismatch",
    helpFragment: "chem-placement-003-role-folder-mismatch",
  },
  "CHEM-PLACEMENT-004": {
    code: "CHEM-PLACEMENT-004",
    category: "PLACEMENT",
    level: "error",
    trKey: "diagnostic.unresolvable_placement",
    helpFragment: "chem-placement-004-unresolvable-placement",
  },

  // ---- PUBLIC ----
  "CHEM-PUBLIC-001": {
    code: "CHEM-PUBLIC-001",
    category: "PUBLIC",
    level: "warning",
    trKey: "diagnostic.public_surface_missing",
    helpFragment: "chem-public-001-public-surface-missing",
  },

  // ---- EXPORT ----
  "CHEM-EXPORT-001": {
    code: "CHEM-EXPORT-001",
    category: "EXPORT",
    level: "error",
    trKey: "diagnostic.export_no_unit",
    helpFragment: "chem-export-001-export-no-unit",
  },

  // ---- IMPORT ----
  "CHEM-IMPORT-001": {
    code: "CHEM-IMPORT-001",
    category: "IMPORT",
    level: "error",
    trKey: "diagnostic.import_existence",
    helpFragment: "chem-import-001-import-existence",
  },
  "CHEM-IMPORT-002": {
    code: "CHEM-IMPORT-002",
    category: "IMPORT",
    level: "error",
    trKey: "diagnostic.import_specificity",
    helpFragment: "chem-import-002-import-specificity",
  },
  "CHEM-IMPORT-003": {
    code: "CHEM-IMPORT-003",
    category: "IMPORT",
    level: "error",
    trKey: "diagnostic.import_undeclared",
    helpFragment: "chem-import-003-import-undeclared",
  },
  "CHEM-IMPORT-004": {
    code: "CHEM-IMPORT-004",
    category: "IMPORT",
    level: "error",
    trKey: "diagnostic.import_bypass",
    helpFragment: "chem-import-004-import-bypass",
  },

  // ---- IMPORT-CROSS-LANG ----
  "CHEM-IMPORT-CROSS-LANG-001": {
    code: "CHEM-IMPORT-CROSS-LANG-001",
    category: "IMPORT-CROSS-LANG",
    level: "error",
    trKey: "diagnostic.cross_language_import",
    helpFragment: "chem-import-cross-lang-001-cross-language-import",
  },

  // ---- TYPE ----
  "CHEM-TYPE-001": {
    code: "CHEM-TYPE-001",
    category: "TYPE",
    level: "error",
    trKey: "diagnostic.compound_type_cannot_import",
    helpFragment: "chem-type-001-compound-type-cannot-import",
  },
  "CHEM-TYPE-002": {
    code: "CHEM-TYPE-002",
    category: "TYPE",
    level: "error",
    trKey: "diagnostic.compound_type_target_uniport",
    helpFragment: "chem-type-002-compound-type-target-uniport",
  },
  "CHEM-TYPE-003": {
    code: "CHEM-TYPE-003",
    category: "TYPE",
    level: "error",
    trKey: "diagnostic.compound_type_target_same_type",
    helpFragment: "chem-type-003-compound-type-target-same-type",
  },

  // ---- BOND ----
  "CHEM-BOND-001": {
    code: "CHEM-BOND-001",
    category: "BOND",
    level: "error",
    trKey: "diagnostic.bond_unresolved",
    helpFragment: "chem-bond-001-bond-unresolved",
  },
  "CHEM-BOND-002": {
    code: "CHEM-BOND-002",
    category: "BOND",
    level: "error",
    trKey: "diagnostic.bond_violation",
    helpFragment: "chem-bond-002-bond-violation",
  },
  "CHEM-BOND-003": {
    code: "CHEM-BOND-003",
    category: "BOND",
    level: "error",
    trKey: "diagnostic.import_bond_violation",
    helpFragment: "chem-bond-003-import-bond-violation",
  },

  // ---- SIGNAL ----
  "CHEM-SIGNAL-001": {
    code: "CHEM-SIGNAL-001",
    category: "SIGNAL",
    level: "error",
    trKey: "diagnostic.signal_emitter_not_reaction",
    helpFragment: "chem-signal-001-signal-emitter-not-reaction",
  },
  "CHEM-SIGNAL-002": {
    code: "CHEM-SIGNAL-002",
    category: "SIGNAL",
    level: "error",
    trKey: "diagnostic.signal_handler_not_reaction",
    helpFragment: "chem-signal-002-signal-handler-not-reaction",
  },
  "CHEM-SIGNAL-003": {
    code: "CHEM-SIGNAL-003",
    category: "SIGNAL",
    level: "warning",
    trKey: "diagnostic.signal_orphaned_listener",
    helpFragment: "chem-signal-003-signal-orphaned-listener",
  },

  // ---- WIRING ----
  "CHEM-WIRING-001": {
    code: "CHEM-WIRING-001",
    category: "WIRING",
    level: "error",
    trKey: "diagnostic.wiring_compound_missing",
    helpFragment: "chem-wiring-001-wiring-compound-missing",
  },
  "CHEM-WIRING-002": {
    code: "CHEM-WIRING-002",
    category: "WIRING",
    level: "error",
    trKey: "diagnostic.wiring_interface_missing",
    helpFragment: "chem-wiring-002-wiring-interface-missing",
  },
  "CHEM-WIRING-003": {
    code: "CHEM-WIRING-003",
    category: "WIRING",
    level: "error",
    trKey: "diagnostic.wiring_adapter_missing",
    helpFragment: "chem-wiring-003-wiring-adapter-missing",
  },
  "CHEM-WIRING-004": {
    code: "CHEM-WIRING-004",
    category: "WIRING",
    level: "error",
    trKey: "diagnostic.wiring_adapter_no_implements",
    helpFragment: "chem-wiring-004-wiring-adapter-no-implements",
  },

  // ---- ASSAY ----
  "CHEM-ASSAY-001": {
    code: "CHEM-ASSAY-001",
    category: "ASSAY",
    level: "warning",
    trKey: "diagnostic.assay_subject_unknown",
    helpFragment: "chem-assay-001-assay-subject-unknown",
  },
  "CHEM-ASSAY-002": {
    code: "CHEM-ASSAY-002",
    category: "ASSAY",
    level: "warning",
    trKey: "diagnostic.assay_mock_not_interface",
    helpFragment: "chem-assay-002-assay-mock-not-interface",
  },

  // ---- EMIT-RULES ----
  "CHEM-EMIT-RULES-001": {
    code: "CHEM-EMIT-RULES-001",
    category: "EMIT-RULES",
    level: "error",
    trKey: "diagnostic.markers_missing_no_overwrite",
    helpFragment: "chem-emit-rules-001-markers-missing-no-overwrite",
  },
  "CHEM-EMIT-RULES-002": {
    code: "CHEM-EMIT-RULES-002",
    category: "EMIT-RULES",
    level: "warning",
    trKey: "diagnostic.line_budget_exceeded",
    helpFragment: "chem-emit-rules-002-line-budget-exceeded",
  },
  "CHEM-EMIT-RULES-003": {
    code: "CHEM-EMIT-RULES-003",
    category: "EMIT-RULES",
    level: "error",
    trKey: "diagnostic.unknown_emitter_tool",
    helpFragment: "chem-emit-rules-003-unknown-emitter-tool",
  },

  // ---- MCP ----
  "CHEM-MCP-001": {
    code: "CHEM-MCP-001",
    category: "MCP",
    level: "error",
    trKey: "diagnostic.mcp_workspace_required",
    helpFragment: "chem-mcp-001-mcp-workspace-required",
  },
  "CHEM-MCP-002": {
    code: "CHEM-MCP-002",
    category: "MCP",
    level: "error",
    trKey: "diagnostic.mcp_transport_unsupported",
    helpFragment: "chem-mcp-002-mcp-transport-unsupported",
  },
  "CHEM-MCP-003": {
    code: "CHEM-MCP-003",
    category: "MCP",
    level: "error",
    trKey: "diagnostic.mcp_initialize_failed",
    helpFragment: "chem-mcp-003-mcp-initialize-failed",
  },
  "CHEM-MCP-101": {
    code: "CHEM-MCP-101",
    category: "MCP",
    level: "error",
    trKey: "diagnostic.tool_input_invalid",
    helpFragment: "chem-mcp-101-tool-input-invalid",
  },
  "CHEM-MCP-102": {
    code: "CHEM-MCP-102",
    category: "MCP",
    level: "error",
    trKey: "diagnostic.tool_unknown",
    helpFragment: "chem-mcp-102-tool-unknown",
  },
  "CHEM-MCP-103": {
    code: "CHEM-MCP-103",
    category: "MCP",
    level: "error",
    trKey: "diagnostic.tool_handler_failed",
    helpFragment: "chem-mcp-103-tool-handler-failed",
  },
  "CHEM-MCP-201": {
    code: "CHEM-MCP-201",
    category: "MCP",
    level: "error",
    trKey: "diagnostic.mcp_client_unknown",
    helpFragment: "chem-mcp-201-mcp-client-unknown",
  },
  "CHEM-MCP-202": {
    code: "CHEM-MCP-202",
    category: "MCP",
    level: "error",
    trKey: "diagnostic.mcp_client_config_invalid_json",
    helpFragment: "chem-mcp-202-mcp-client-config-invalid-json",
  },
  "CHEM-MCP-203": {
    code: "CHEM-MCP-203",
    category: "MCP",
    level: "error",
    trKey: "diagnostic.mcp_client_cli_failed",
    helpFragment: "chem-mcp-203-mcp-client-cli-failed",
  },
  "CHEM-MCP-301": {
    code: "CHEM-MCP-301",
    category: "MCP",
    level: "error",
    trKey: "diagnostic.resource_uri_invalid",
    helpFragment: "chem-mcp-301-resource-uri-invalid",
  },
  "CHEM-MCP-302": {
    code: "CHEM-MCP-302",
    category: "MCP",
    level: "error",
    trKey: "diagnostic.resource_compound_not_found",
    helpFragment: "chem-mcp-302-resource-compound-not-found",
  },
  "CHEM-MCP-303": {
    code: "CHEM-MCP-303",
    category: "MCP",
    level: "error",
    trKey: "diagnostic.resource_docs_section_unknown",
    helpFragment: "chem-mcp-303-resource-docs-section-unknown",
  },

  // ---- INSTALL-HOOKS ----
  "CHEM-INSTALL-HOOKS-001": {
    code: "CHEM-INSTALL-HOOKS-001",
    category: "INSTALL-HOOKS",
    level: "error",
    trKey: "diagnostic.tool_not_yet_implemented",
    helpFragment: "chem-install-hooks-001-tool-not-yet-implemented",
  },
  "CHEM-INSTALL-HOOKS-002": {
    code: "CHEM-INSTALL-HOOKS-002",
    category: "INSTALL-HOOKS",
    level: "error",
    trKey: "diagnostic.settings_file_invalid_json",
    helpFragment: "chem-install-hooks-002-settings-file-invalid-json",
  },
  "CHEM-INSTALL-HOOKS-003": {
    code: "CHEM-INSTALL-HOOKS-003",
    category: "INSTALL-HOOKS",
    level: "warning",
    trKey: "diagnostic.hooks_already_installed_no_force",
    helpFragment: "chem-install-hooks-003-hooks-already-installed-no-force",
  },
  "CHEM-INSTALL-HOOKS-004": {
    code: "CHEM-INSTALL-HOOKS-004",
    category: "INSTALL-HOOKS",
    level: "error",
    trKey: "diagnostic.unknown_scope",
    helpFragment: "chem-install-hooks-004-unknown-scope",
  },
  "CHEM-INSTALL-HOOKS-005": {
    code: "CHEM-INSTALL-HOOKS-005",
    category: "INSTALL-HOOKS",
    level: "warning",
    trKey: "diagnostic.no_chemag_entries_to_uninstall",
    helpFragment: "chem-install-hooks-005-no-chemag-entries-to-uninstall",
  },
  "CHEM-INSTALL-HOOKS-006": {
    code: "CHEM-INSTALL-HOOKS-006",
    category: "INSTALL-HOOKS",
    level: "warning",
    trKey: "diagnostic.hook_stdin_unparseable",
    helpFragment: "chem-install-hooks-006-hook-stdin-unparseable",
  },
  "CHEM-INSTALL-HOOKS-007": {
    code: "CHEM-INSTALL-HOOKS-007",
    category: "INSTALL-HOOKS",
    level: "error",
    trKey: "diagnostic.husky_not_detected",
    helpFragment: "chem-install-hooks-007-husky-not-detected",
  },
  "CHEM-INSTALL-HOOKS-008": {
    code: "CHEM-INSTALL-HOOKS-008",
    category: "INSTALL-HOOKS",
    level: "error",
    trKey: "diagnostic.cursor_precommit_unparseable",
    helpFragment: "chem-install-hooks-008-cursor-precommit-unparseable",
  },
  "CHEM-INSTALL-HOOKS-009": {
    code: "CHEM-INSTALL-HOOKS-009",
    category: "INSTALL-HOOKS",
    level: "error",
    trKey: "diagnostic.aider_conf_invalid_yaml",
    helpFragment: "chem-install-hooks-009-aider-conf-invalid-yaml",
  },
  "CHEM-INSTALL-HOOKS-010": {
    code: "CHEM-INSTALL-HOOKS-010",
    category: "INSTALL-HOOKS",
    level: "error",
    trKey: "diagnostic.copilot_workflow_exists_no_overwrite",
    helpFragment: "chem-install-hooks-010-copilot-workflow-exists-no-overwrite",
  },
};

/**
 * Type-safe accessor — returns the meta for a known DiagnosticCode at compile
 * time, or `undefined` for arbitrary strings (e.g. user input from --explain).
 */
export function getDiagnosticCodeMeta(code: string): DiagnosticCodeMeta | undefined {
  return (DIAGNOSTIC_CODES as Record<string, DiagnosticCodeMeta>)[code];
}

/**
 * Codes that are intentionally reserved (planned but not yet implemented)
 * and thus do NOT appear in `DIAGNOSTIC_CODES`. The numbering-monotonicity
 * registry test consults this set to permit a gap inside a 100-block when
 * the missing NNN corresponds to a reserved code. Use sparingly — every
 * entry here is a promise to ship the code in a future WP.
 *
 * Reserved entries are documented in `docs/master-plan/` (e.g.
 * `11-track-r-rule-remediation.md` § proposed-rules for the PORT family).
 */
export const RESERVED_CODES: ReadonlySet<string> = new Set<string>([
  // PORT-002 — Tier 3 rule (see proposed-rules.md), shipped in a future WP.
  "CHEM-PORT-002",
]);
