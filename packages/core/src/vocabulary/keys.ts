// ---------------------------------------------------------------------------
// TrKey — exhaustive, compile-time-checked translation key registry.
//
// Every user-facing string in the toolkit goes through tr(key, params?). The
// runtime asserts (via the snapshot test) that every key in this union has a
// matching entry in every locale JSON file.
//
// Group organization:
//   role.*       — names for the six unit roles
//   container.*  — names for the four compound container types
//   concept.*    — names for cross-cutting concepts (bond/unit/signal/assay)
//   diagnostic.* — one per check function emitting a message
//   cli.*        — top-level CLI help text and per-command help blurbs
//   claude_md.*  — CLAUDE.md section blocks emitted by template-claude-md
// ---------------------------------------------------------------------------

export type TrKey =
  // ---- Roles ----
  | "role.element"
  | "role.molecule"
  | "role.reaction"
  | "role.interface"
  | "role.adapter"
  | "role.buffer"
  // ---- Containers ----
  | "container.compound"
  | "container.reagent"
  | "container.solvent"
  | "container.catalyst"
  // ---- Concepts ----
  | "concept.bond"
  | "concept.unit"
  | "concept.signal"
  | "concept.assay"
  // ---- Diagnostics — one key per check producing a unique message shape ----
  // checks.ts
  | "diagnostic.duplicate_compound" // params: { name, other }
  | "diagnostic.unknown_role" // params: { unit, role, known }
  | "diagnostic.file_missing_unit" // params: { unit, file, abs }
  | "diagnostic.file_missing_assay" // params: { assay, file, abs }
  | "diagnostic.public_surface_missing" // params: { surface, abs }
  | "diagnostic.role_folder_mismatch" // params: { unit, role, expected, file }
  | "diagnostic.export_no_unit" // params: { name, key, role }
  | "diagnostic.import_existence" // params: { compound }
  | "diagnostic.import_specificity" // params: { name, compound }
  | "diagnostic.compound_type_cannot_import" // params: { target, target_type, self_type, allowed }
  | "diagnostic.compound_type_target_uniport" // params: { target, target_type }
  | "diagnostic.compound_type_target_same_type" // params: { target, target_type }
  | "diagnostic.bond_unresolved" // params: { src_name, dep }
  | "diagnostic.bond_violation" // params: { src_name, src_role, dep, dep_role, allowed }
  | "diagnostic.signal_emitter_not_reaction" // params: { signal, emitter }
  | "diagnostic.signal_handler_not_reaction" // params: { signal, handler }
  | "diagnostic.signal_orphaned_listener" // params: { signal }
  | "diagnostic.wiring_compound_missing" // params: { compound }
  | "diagnostic.wiring_interface_missing" // params: { iface, compound }
  | "diagnostic.wiring_adapter_missing" // params: { adapter, compound }
  | "diagnostic.wiring_adapter_no_implements" // params: { adapter, iface, compound }
  | "diagnostic.singleton_violated" // params: { type, count, names }
  | "diagnostic.role_not_allowed_for_type" // params: { unit, role, type, allowed }
  | "diagnostic.assay_subject_unknown" // params: { assay, subject }
  | "diagnostic.assay_mock_not_interface" // params: { assay, mock }
  // import-check.ts
  | "diagnostic.import_bond_violation" // params: { file, src_role, target_role, names, allowed }
  | "diagnostic.import_undeclared" // params: { file, target, src_compound }
  | "diagnostic.import_bypass" // params: { file, target, surface }
  // check-edit.ts
  | "diagnostic.unresolvable_placement" // params: { file }
  // rules-emitters
  | "diagnostic.markers_missing_no_overwrite" // params: { path }
  | "diagnostic.line_budget_exceeded" // params: { tool, actual, budget }
  | "diagnostic.unknown_emitter_tool" // params: { tool, supported }
  // mcp-server (CHEM-MCP-001/002/003)
  | "diagnostic.mcp_workspace_required"
  | "diagnostic.mcp_transport_unsupported" // params: { transport }
  | "diagnostic.mcp_initialize_failed" // params: { reason }
  // mcp-server tool dispatch (CHEM-MCP-101/102/103)
  | "diagnostic.tool_input_invalid" // params: { tool, reason }
  | "diagnostic.tool_unknown" // params: { tool }
  | "diagnostic.tool_handler_failed" // params: { tool, reason }
  // install-hooks (CHEM-INSTALL-HOOKS-001..006)
  | "diagnostic.tool_not_yet_implemented" // params: { tool }
  | "diagnostic.settings_file_invalid_json" // params: { path, reason }
  | "diagnostic.hooks_already_installed_no_force" // params: { path }
  | "diagnostic.unknown_scope" // params: { scope }
  | "diagnostic.no_chemag_entries_to_uninstall" // params: { path }
  | "diagnostic.hook_stdin_unparseable" // params: { reason }
  // ---- CLI help (top-level + per-command) ----
  | "cli.help.intro" // params: { version }
  | "cli.help.usage"
  | "cli.help.commands"
  | "cli.help.options"
  | "cli.help.no_cache"
  | "cli.command.init"
  | "cli.command.add"
  | "cli.command.check"
  | "cli.command.analyze"
  | "cli.command.scaffold"
  | "cli.command.graph"
  | "cli.command.sync"
  | "cli.command.emit_rules"
  | "cli.command.mcp"
  | "cli.command.install_hooks"
  | "cli.help.mcp.transport"
  | "cli.help.mcp.workspace"
  | "cli.help.install_hooks.tool"
  | "cli.help.install_hooks.scope"
  | "cli.help.install_hooks.mode"
  // ---- CLAUDE.md template sections ----
  | "claude_md.intro"
  | "claude_md.roles_table"
  | "claude_md.bonds_table"
  | "claude_md.compound_types"
  | "claude_md.workflow"
  | "claude_md.tool_reference"
  | "claude_md.ai_rules";

// Compile-time exhaustive list. The snapshot test imports this and walks every
// key, asserting both locale JSON files contain it.
export const ALL_TR_KEYS: readonly TrKey[] = [
  "role.element",
  "role.molecule",
  "role.reaction",
  "role.interface",
  "role.adapter",
  "role.buffer",
  "container.compound",
  "container.reagent",
  "container.solvent",
  "container.catalyst",
  "concept.bond",
  "concept.unit",
  "concept.signal",
  "concept.assay",
  "diagnostic.duplicate_compound",
  "diagnostic.unknown_role",
  "diagnostic.file_missing_unit",
  "diagnostic.file_missing_assay",
  "diagnostic.public_surface_missing",
  "diagnostic.role_folder_mismatch",
  "diagnostic.export_no_unit",
  "diagnostic.import_existence",
  "diagnostic.import_specificity",
  "diagnostic.compound_type_cannot_import",
  "diagnostic.compound_type_target_uniport",
  "diagnostic.compound_type_target_same_type",
  "diagnostic.bond_unresolved",
  "diagnostic.bond_violation",
  "diagnostic.signal_emitter_not_reaction",
  "diagnostic.signal_handler_not_reaction",
  "diagnostic.signal_orphaned_listener",
  "diagnostic.wiring_compound_missing",
  "diagnostic.wiring_interface_missing",
  "diagnostic.wiring_adapter_missing",
  "diagnostic.wiring_adapter_no_implements",
  "diagnostic.singleton_violated",
  "diagnostic.role_not_allowed_for_type",
  "diagnostic.assay_subject_unknown",
  "diagnostic.assay_mock_not_interface",
  "diagnostic.import_bond_violation",
  "diagnostic.import_undeclared",
  "diagnostic.import_bypass",
  "diagnostic.unresolvable_placement",
  "diagnostic.markers_missing_no_overwrite",
  "diagnostic.line_budget_exceeded",
  "diagnostic.unknown_emitter_tool",
  "diagnostic.mcp_workspace_required",
  "diagnostic.mcp_transport_unsupported",
  "diagnostic.mcp_initialize_failed",
  "diagnostic.tool_input_invalid",
  "diagnostic.tool_unknown",
  "diagnostic.tool_handler_failed",
  "diagnostic.tool_not_yet_implemented",
  "diagnostic.settings_file_invalid_json",
  "diagnostic.hooks_already_installed_no_force",
  "diagnostic.unknown_scope",
  "diagnostic.no_chemag_entries_to_uninstall",
  "diagnostic.hook_stdin_unparseable",
  "cli.help.intro",
  "cli.help.usage",
  "cli.help.commands",
  "cli.help.options",
  "cli.help.no_cache",
  "cli.command.init",
  "cli.command.add",
  "cli.command.check",
  "cli.command.analyze",
  "cli.command.scaffold",
  "cli.command.graph",
  "cli.command.sync",
  "cli.command.emit_rules",
  "cli.command.mcp",
  "cli.command.install_hooks",
  "cli.help.mcp.transport",
  "cli.help.mcp.workspace",
  "cli.help.install_hooks.tool",
  "cli.help.install_hooks.scope",
  "cli.help.install_hooks.mode",
  "claude_md.intro",
  "claude_md.roles_table",
  "claude_md.bonds_table",
  "claude_md.compound_types",
  "claude_md.workflow",
  "claude_md.tool_reference",
  "claude_md.ai_rules",
];
