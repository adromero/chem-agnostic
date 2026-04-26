// ---------------------------------------------------------------------------
// Shared diagnostic fixtures for the format/* tests. Each fixture mimics what
// a real check would produce: full Diagnostic shape including (where
// applicable) `file` and `compound`. Codes are drawn from the registry.
// ---------------------------------------------------------------------------
import { DIAGNOSTIC_CODES, type DiagnosticCode } from "@chemag/core/diagnostics";
import type { Diagnostic } from "@chemag/core/types";
import type { FormatContext } from "../../src/format/index.js";

const WORKSPACE_PATH = "/home/work/myrepo";

/** Default FormatContext for `check`-style invocations. */
export function makeCheckContext(overrides?: Partial<FormatContext>): FormatContext {
  return {
    workspaceName: "test-app",
    workspacePath: WORKSPACE_PATH,
    command: "check",
    toolVersion: "0.1.0",
    totals: { compounds: 4, units: 7, assays: 0, passed: 8, failed: 1 },
    ...overrides,
  };
}

/** Default FormatContext for `analyze`-style invocations. */
export function makeAnalyzeContext(overrides?: Partial<FormatContext>): FormatContext {
  return {
    workspaceName: "test-app",
    workspacePath: WORKSPACE_PATH,
    command: "analyze",
    toolVersion: "0.1.0",
    totals: { units: 7 },
    ...overrides,
  };
}

/** Default FormatContext for `check-edit` invocations. */
export function makeCheckEditContext(overrides?: Partial<FormatContext>): FormatContext {
  return {
    workspaceName: "test-app",
    workspacePath: WORKSPACE_PATH,
    command: "check-edit",
    toolVersion: "0.1.0",
    fileContext: {
      file: `${WORKSPACE_PATH}/src/compounds/orders/reactions/createOrder.ts`,
      compound: "orders",
      role: "reaction",
    },
    ...overrides,
  };
}

/** Build a workspace-level (no `file`) error fixture. */
export function workspaceLevelDiag(): Diagnostic {
  return {
    level: "error",
    check: "manifest",
    code: "CHEM-MANIFEST-001",
    message: 'Duplicate module name "dup"',
  };
}

/** Build a source-level (with `file`) error fixture. */
export function sourceLevelDiag(): Diagnostic {
  return {
    level: "error",
    check: "import-bonds",
    code: "CHEM-BOND-003",
    compound: "orders",
    message: 'createOrder.ts: reaction imports adapter "PgBilling" — dependency rule violation',
    hint: "reaction can only import from [element, molecule, interface]",
    file: `${WORKSPACE_PATH}/src/compounds/orders/reactions/createOrder.ts`,
  };
}

/** A warning. */
export function warningDiag(): Diagnostic {
  return {
    level: "warning",
    check: "public-surface",
    code: "CHEM-PUBLIC-001",
    compound: "orders",
    message: "Module exports units but has no public.ts",
  };
}

/** A diagnostic with a remediation hint (kind: import_via_public_surface). */
export function diagWithRemediation(): Diagnostic {
  return {
    level: "error",
    check: "import-bypass",
    code: "CHEM-IMPORT-004",
    compound: "orders",
    message: 'createOrder.ts: imports directly from "billing" internal file instead of public.ts',
    hint: 'Import from "billing/public.ts" instead',
    file: `${WORKSPACE_PATH}/src/compounds/orders/reactions/createOrder.ts`,
    remediation: {
      kind: "import_via_public_surface",
      surface: "public.ts",
      target_compound: "billing",
    },
  };
}

/**
 * Build one diagnostic per registered DiagnosticCode. Used by the
 * "registry coverage" tests to assert SARIF rules cover every code and
 * the JSON envelope round-trips for every code.
 */
export function oneOfEachDiagnostic(): Diagnostic[] {
  return Object.values(DIAGNOSTIC_CODES).map((meta) => {
    const d: Diagnostic = {
      level: meta.level,
      check: meta.code.toLowerCase(),
      code: meta.code as DiagnosticCode,
      compound: meta.code.startsWith("CHEM-MANIFEST-") ? undefined : "fixture",
      message: `Synthetic diagnostic for ${meta.code}`,
    };
    // Source-level codes get a file path so SARIF emits a physicalLocation.
    if (
      meta.code.startsWith("CHEM-IMPORT-") ||
      meta.code.startsWith("CHEM-BOND-") ||
      meta.code === "CHEM-PLACEMENT-001" ||
      meta.code === "CHEM-PLACEMENT-002" ||
      meta.code === "CHEM-PLACEMENT-003" ||
      meta.code === "CHEM-PLACEMENT-004"
    ) {
      d.file = `${WORKSPACE_PATH}/src/compounds/fixture/elements/X.ts`;
    }
    return d;
  });
}
