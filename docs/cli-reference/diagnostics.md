# Diagnostic codes

> **NOTE:** Generated index — will be migrated to `apps/docs-site/src/content/docs/cli-reference/diagnostics.md` in WP-053. Do not hand-edit; regenerate via `npm run gen:diagnostics`.

Every diagnostic emitted by `chemag check` and `chemag analyze` carries a stable `CHEM-CATEGORY-NNN` code. Codes are bijective with the `diagnostic.*` TrKey set in `packages/core/src/vocabulary/keys.ts`. Run `chemag check --explain CHEM-XXX-NNN` to read the entry from the terminal.

## Summary

| Code | Category | Level | TrKey |
|---|---|---|---|
| [`CHEM-ASSAY-001`](#chem-assay-001-assay-subject-unknown) | ASSAY | warning | `diagnostic.assay_subject_unknown` |
| [`CHEM-ASSAY-002`](#chem-assay-002-assay-mock-not-interface) | ASSAY | warning | `diagnostic.assay_mock_not_interface` |
| [`CHEM-BOND-001`](#chem-bond-001-bond-unresolved) | BOND | error | `diagnostic.bond_unresolved` |
| [`CHEM-BOND-002`](#chem-bond-002-bond-violation) | BOND | error | `diagnostic.bond_violation` |
| [`CHEM-BOND-003`](#chem-bond-003-import-bond-violation) | BOND | error | `diagnostic.import_bond_violation` |
| [`CHEM-EXPORT-001`](#chem-export-001-export-no-unit) | EXPORT | error | `diagnostic.export_no_unit` |
| [`CHEM-IMPORT-001`](#chem-import-001-import-existence) | IMPORT | error | `diagnostic.import_existence` |
| [`CHEM-IMPORT-002`](#chem-import-002-import-specificity) | IMPORT | error | `diagnostic.import_specificity` |
| [`CHEM-IMPORT-003`](#chem-import-003-import-undeclared) | IMPORT | error | `diagnostic.import_undeclared` |
| [`CHEM-IMPORT-004`](#chem-import-004-import-bypass) | IMPORT | error | `diagnostic.import_bypass` |
| [`CHEM-MANIFEST-001`](#chem-manifest-001-duplicate-compound) | MANIFEST | error | `diagnostic.duplicate_compound` |
| [`CHEM-MANIFEST-002`](#chem-manifest-002-singleton-violated) | MANIFEST | error | `diagnostic.singleton_violated` |
| [`CHEM-PLACEMENT-001`](#chem-placement-001-file-missing-unit) | PLACEMENT | error | `diagnostic.file_missing_unit` |
| [`CHEM-PLACEMENT-002`](#chem-placement-002-file-missing-assay) | PLACEMENT | error | `diagnostic.file_missing_assay` |
| [`CHEM-PLACEMENT-003`](#chem-placement-003-role-folder-mismatch) | PLACEMENT | error | `diagnostic.role_folder_mismatch` |
| [`CHEM-PUBLIC-001`](#chem-public-001-public-surface-missing) | PUBLIC | warning | `diagnostic.public_surface_missing` |
| [`CHEM-ROLE-001`](#chem-role-001-unknown-role) | ROLE | error | `diagnostic.unknown_role` |
| [`CHEM-ROLE-002`](#chem-role-002-role-not-allowed-for-type) | ROLE | error | `diagnostic.role_not_allowed_for_type` |
| [`CHEM-SIGNAL-001`](#chem-signal-001-signal-emitter-not-reaction) | SIGNAL | error | `diagnostic.signal_emitter_not_reaction` |
| [`CHEM-SIGNAL-002`](#chem-signal-002-signal-handler-not-reaction) | SIGNAL | error | `diagnostic.signal_handler_not_reaction` |
| [`CHEM-SIGNAL-003`](#chem-signal-003-signal-orphaned-listener) | SIGNAL | warning | `diagnostic.signal_orphaned_listener` |
| [`CHEM-TYPE-001`](#chem-type-001-compound-type-cannot-import) | TYPE | error | `diagnostic.compound_type_cannot_import` |
| [`CHEM-TYPE-002`](#chem-type-002-compound-type-target-uniport) | TYPE | error | `diagnostic.compound_type_target_uniport` |
| [`CHEM-TYPE-003`](#chem-type-003-compound-type-target-same-type) | TYPE | error | `diagnostic.compound_type_target_same_type` |
| [`CHEM-WIRING-001`](#chem-wiring-001-wiring-compound-missing) | WIRING | error | `diagnostic.wiring_compound_missing` |
| [`CHEM-WIRING-002`](#chem-wiring-002-wiring-interface-missing) | WIRING | error | `diagnostic.wiring_interface_missing` |
| [`CHEM-WIRING-003`](#chem-wiring-003-wiring-adapter-missing) | WIRING | error | `diagnostic.wiring_adapter_missing` |
| [`CHEM-WIRING-004`](#chem-wiring-004-wiring-adapter-no-implements) | WIRING | error | `diagnostic.wiring_adapter_no_implements` |

## MANIFEST

### CHEM-MANIFEST-001 { #chem-manifest-001-duplicate-compound }

- **Category:** MANIFEST
- **Level:** error
- **TrKey:** `diagnostic.duplicate_compound`

### CHEM-MANIFEST-002 { #chem-manifest-002-singleton-violated }

- **Category:** MANIFEST
- **Level:** error
- **TrKey:** `diagnostic.singleton_violated`

## ROLE

### CHEM-ROLE-001 { #chem-role-001-unknown-role }

- **Category:** ROLE
- **Level:** error
- **TrKey:** `diagnostic.unknown_role`

### CHEM-ROLE-002 { #chem-role-002-role-not-allowed-for-type }

- **Category:** ROLE
- **Level:** error
- **TrKey:** `diagnostic.role_not_allowed_for_type`

## PLACEMENT

### CHEM-PLACEMENT-001 { #chem-placement-001-file-missing-unit }

- **Category:** PLACEMENT
- **Level:** error
- **TrKey:** `diagnostic.file_missing_unit`

### CHEM-PLACEMENT-002 { #chem-placement-002-file-missing-assay }

- **Category:** PLACEMENT
- **Level:** error
- **TrKey:** `diagnostic.file_missing_assay`

### CHEM-PLACEMENT-003 { #chem-placement-003-role-folder-mismatch }

- **Category:** PLACEMENT
- **Level:** error
- **TrKey:** `diagnostic.role_folder_mismatch`

## PUBLIC

### CHEM-PUBLIC-001 { #chem-public-001-public-surface-missing }

- **Category:** PUBLIC
- **Level:** warning
- **TrKey:** `diagnostic.public_surface_missing`

## EXPORT

### CHEM-EXPORT-001 { #chem-export-001-export-no-unit }

- **Category:** EXPORT
- **Level:** error
- **TrKey:** `diagnostic.export_no_unit`

## IMPORT

### CHEM-IMPORT-001 { #chem-import-001-import-existence }

- **Category:** IMPORT
- **Level:** error
- **TrKey:** `diagnostic.import_existence`

### CHEM-IMPORT-002 { #chem-import-002-import-specificity }

- **Category:** IMPORT
- **Level:** error
- **TrKey:** `diagnostic.import_specificity`

### CHEM-IMPORT-003 { #chem-import-003-import-undeclared }

- **Category:** IMPORT
- **Level:** error
- **TrKey:** `diagnostic.import_undeclared`

### CHEM-IMPORT-004 { #chem-import-004-import-bypass }

- **Category:** IMPORT
- **Level:** error
- **TrKey:** `diagnostic.import_bypass`

## TYPE

### CHEM-TYPE-001 { #chem-type-001-compound-type-cannot-import }

- **Category:** TYPE
- **Level:** error
- **TrKey:** `diagnostic.compound_type_cannot_import`

### CHEM-TYPE-002 { #chem-type-002-compound-type-target-uniport }

- **Category:** TYPE
- **Level:** error
- **TrKey:** `diagnostic.compound_type_target_uniport`

### CHEM-TYPE-003 { #chem-type-003-compound-type-target-same-type }

- **Category:** TYPE
- **Level:** error
- **TrKey:** `diagnostic.compound_type_target_same_type`

## BOND

### CHEM-BOND-001 { #chem-bond-001-bond-unresolved }

- **Category:** BOND
- **Level:** error
- **TrKey:** `diagnostic.bond_unresolved`

### CHEM-BOND-002 { #chem-bond-002-bond-violation }

- **Category:** BOND
- **Level:** error
- **TrKey:** `diagnostic.bond_violation`

### CHEM-BOND-003 { #chem-bond-003-import-bond-violation }

- **Category:** BOND
- **Level:** error
- **TrKey:** `diagnostic.import_bond_violation`

## SIGNAL

### CHEM-SIGNAL-001 { #chem-signal-001-signal-emitter-not-reaction }

- **Category:** SIGNAL
- **Level:** error
- **TrKey:** `diagnostic.signal_emitter_not_reaction`

### CHEM-SIGNAL-002 { #chem-signal-002-signal-handler-not-reaction }

- **Category:** SIGNAL
- **Level:** error
- **TrKey:** `diagnostic.signal_handler_not_reaction`

### CHEM-SIGNAL-003 { #chem-signal-003-signal-orphaned-listener }

- **Category:** SIGNAL
- **Level:** warning
- **TrKey:** `diagnostic.signal_orphaned_listener`

## WIRING

### CHEM-WIRING-001 { #chem-wiring-001-wiring-compound-missing }

- **Category:** WIRING
- **Level:** error
- **TrKey:** `diagnostic.wiring_compound_missing`

### CHEM-WIRING-002 { #chem-wiring-002-wiring-interface-missing }

- **Category:** WIRING
- **Level:** error
- **TrKey:** `diagnostic.wiring_interface_missing`

### CHEM-WIRING-003 { #chem-wiring-003-wiring-adapter-missing }

- **Category:** WIRING
- **Level:** error
- **TrKey:** `diagnostic.wiring_adapter_missing`

### CHEM-WIRING-004 { #chem-wiring-004-wiring-adapter-no-implements }

- **Category:** WIRING
- **Level:** error
- **TrKey:** `diagnostic.wiring_adapter_no_implements`

## ASSAY

### CHEM-ASSAY-001 { #chem-assay-001-assay-subject-unknown }

- **Category:** ASSAY
- **Level:** warning
- **TrKey:** `diagnostic.assay_subject_unknown`

### CHEM-ASSAY-002 { #chem-assay-002-assay-mock-not-interface }

- **Category:** ASSAY
- **Level:** warning
- **TrKey:** `diagnostic.assay_mock_not_interface`

