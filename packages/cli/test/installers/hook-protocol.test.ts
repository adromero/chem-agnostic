// ---------------------------------------------------------------------------
// Hook-protocol contract tests for `--for-hook claude` mode on both
// `chemag check-edit` and `chemag analyze`. We drive the commands in-process
// (mocking process.exit / stdin reader) and assert the stdout JSON matches
// Claude Code's hook envelope shape.
//
// References: see docs/adrs/0004-hook-install-protocol.md.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import {
  __resetStdinReaderForTesting as resetCheckEditStdin,
  __setStdinReaderForTesting as setCheckEditStdin,
} from "../../src/commands/check-edit.js";
import {
  __resetStdinReaderForTesting as resetAnalyzeStdin,
  __setStdinReaderForTesting as setAnalyzeStdin,
} from "../../src/commands/analyze.js";
import { cmdCheckEdit } from "../../src/commands/check-edit.js";
import { cmdAnalyze } from "../../src/commands/analyze.js";
import { __resetForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting, setCacheEnabled } from "@chemag/core/cache";

let tmpDir: string;
let stdout: string[];
let stderr: string[];
let exitCode: number | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-hook-proto-"));
  __resetForTesting();
  __resetCacheStateForTesting();
  setCacheEnabled(false);
  stdout = [];
  stderr = [];
  exitCode = undefined;

  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new Error("__cli_exit__");
  }) as never);
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetCheckEditStdin();
  resetAnalyzeStdin();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  __resetForTesting();
});

function runCheckEdit(argv: string[]): void {
  try {
    cmdCheckEdit(argv);
  } catch (e: unknown) {
    if ((e as Error).message !== "__cli_exit__") throw e;
  }
}

function runAnalyze(argv: string[]): void {
  try {
    cmdAnalyze(argv);
  } catch (e: unknown) {
    if ((e as Error).message !== "__cli_exit__") throw e;
  }
}

// ---------------------------------------------------------------------------
// Shared workspace fixtures
// ---------------------------------------------------------------------------

const STD_WS = {
  workspace: "hook-app",
  language: "typescript",
  roles: {
    element: { description: "Value", folder: "elements" },
    interface: { description: "Port", folder: "interfaces" },
    adapter: { description: "Adapter", folder: "adapters" },
    reaction: { description: "Workflow", folder: "reactions" },
  },
  bonds: {
    element: ["element"],
    interface: ["element"],
    adapter: ["element", "interface", "adapter"],
    reaction: ["element", "interface"],
  },
  compound_types: {
    compound: { description: "Standard", can_import: ["compound"] },
  },
  paths: { compounds: "src/compounds" },
  rules: {
    cross_compound_imports: "public_only",
    role_from_path: true,
    public_surface: "public.ts",
  },
};

/**
 * Workspace where `orders/reactions/createOrder.ts` imports billing's
 * INTERNAL file directly (CHEM-IMPORT-004 + CHEM-IMPORT-003).
 */
function setupViolationWorkspace(): { wsRoot: string; violatingFile: string } {
  fs.writeFileSync(path.join(tmpDir, "workspace.yaml"), yamlStringify(STD_WS));

  const billing = path.join(tmpDir, "src/compounds/billing");
  fs.mkdirSync(path.join(billing, "interfaces"), { recursive: true });
  fs.writeFileSync(
    path.join(billing, "compound.yaml"),
    yamlStringify({
      compound: "billing",
      exports: { interfaces: ["BillingRepo"] },
      units: [{ role: "interface", name: "BillingRepo", file: "./interfaces/BillingRepo.ts" }],
    }),
  );
  fs.writeFileSync(
    path.join(billing, "interfaces/BillingRepo.ts"),
    "export interface BillingRepo {}\n",
  );
  fs.writeFileSync(
    path.join(billing, "public.ts"),
    'export type { BillingRepo } from "./interfaces/BillingRepo";\n',
  );

  const orders = path.join(tmpDir, "src/compounds/orders");
  fs.mkdirSync(path.join(orders, "reactions"), { recursive: true });
  fs.writeFileSync(
    path.join(orders, "compound.yaml"),
    yamlStringify({
      compound: "orders",
      units: [{ role: "reaction", name: "createOrder", file: "./reactions/createOrder.ts" }],
    }),
  );
  const violating = path.join(orders, "reactions/createOrder.ts");
  fs.writeFileSync(
    violating,
    'import type { BillingRepo } from "../../billing/interfaces/BillingRepo";\nexport async function createOrder(_b: BillingRepo) {}\n',
  );

  return { wsRoot: tmpDir, violatingFile: violating };
}

/** Clean workspace (no violations). */
function setupCleanWorkspace(): { wsRoot: string; cleanFile: string } {
  fs.writeFileSync(path.join(tmpDir, "workspace.yaml"), yamlStringify(STD_WS));

  const orders = path.join(tmpDir, "src/compounds/orders");
  fs.mkdirSync(path.join(orders, "reactions"), { recursive: true });
  fs.writeFileSync(
    path.join(orders, "compound.yaml"),
    yamlStringify({
      compound: "orders",
      units: [{ role: "reaction", name: "noOp", file: "./reactions/noOp.ts" }],
    }),
  );
  const cleanFile = path.join(orders, "reactions/noOp.ts");
  fs.writeFileSync(cleanFile, "export async function noOp() {}\n");

  return { wsRoot: tmpDir, cleanFile };
}

// ---------------------------------------------------------------------------
// PreToolUse — check-edit --for-hook claude
// ---------------------------------------------------------------------------

describe("PreToolUse — deny path (block mode + violation)", () => {
  it("emits permissionDecision: deny with the diagnostic code in the reason", () => {
    const { wsRoot, violatingFile } = setupViolationWorkspace();
    setCheckEditStdin(() =>
      JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: violatingFile },
      }),
    );

    runCheckEdit(["--for-hook", "claude", "--format", "json", "--workspace", wsRoot]);

    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout.join(""));
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/CHEM-/);
  });
});

describe("PreToolUse — ask path (warn mode + violation)", () => {
  it("emits permissionDecision: ask under --mode warn", () => {
    const { wsRoot, violatingFile } = setupViolationWorkspace();
    setCheckEditStdin(() =>
      JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: violatingFile },
      }),
    );

    runCheckEdit([
      "--for-hook",
      "claude",
      "--mode",
      "warn",
      "--format",
      "json",
      "--workspace",
      wsRoot,
    ]);

    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout.join(""));
    expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
  });
});

describe("PreToolUse — allow-omit path (clean file)", () => {
  it("emits no envelope (empty stdout) and exits 0", () => {
    const { wsRoot, cleanFile } = setupCleanWorkspace();
    setCheckEditStdin(() =>
      JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: cleanFile },
      }),
    );

    runCheckEdit(["--for-hook", "claude", "--format", "json", "--workspace", wsRoot]);

    expect(exitCode).toBe(0);
    expect(stdout.join("").trim()).toBe("");
  });
});

describe("PreToolUse — file outside workspace", () => {
  it("silent pass: no envelope, exit 0", () => {
    const { wsRoot } = setupCleanWorkspace();
    const outside = path.join(os.tmpdir(), `chem-outside-${Date.now()}.ts`);
    fs.writeFileSync(outside, "// outside\n");
    try {
      setCheckEditStdin(() =>
        JSON.stringify({
          tool_name: "Edit",
          tool_input: { file_path: outside },
        }),
      );

      runCheckEdit(["--for-hook", "claude", "--format", "json", "--workspace", wsRoot]);

      expect(exitCode).toBe(0);
      expect(stdout.join("").trim()).toBe("");
    } finally {
      fs.unlinkSync(outside);
    }
  });
});

describe("PreToolUse — malformed stdin (fail-soft to allow)", () => {
  it("non-JSON stdin → permissionDecision: allow + 006 stderr + exit 0", () => {
    const { wsRoot } = setupCleanWorkspace();
    setCheckEditStdin(() => "not json at all");

    runCheckEdit(["--for-hook", "claude", "--format", "json", "--workspace", wsRoot]);

    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout.join(""));
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(stderr.join("\n")).toContain("CHEM-INSTALL-HOOKS-006");
  });

  it("missing tool_input.file_path → same allow envelope", () => {
    const { wsRoot } = setupCleanWorkspace();
    setCheckEditStdin(() => JSON.stringify({ tool_name: "Edit", tool_input: {} }));

    runCheckEdit(["--for-hook", "claude", "--format", "json", "--workspace", wsRoot]);

    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout.join(""));
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(stderr.join("\n")).toContain("CHEM-INSTALL-HOOKS-006");
  });
});

// ---------------------------------------------------------------------------
// PostToolUse — analyze --for-hook claude
// ---------------------------------------------------------------------------

describe("PostToolUse — informational envelope (workspace has violations)", () => {
  it("emits additionalContext only; never permissionDecision; exits 0", () => {
    const { wsRoot, violatingFile } = setupViolationWorkspace();
    setAnalyzeStdin(() =>
      JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: violatingFile },
      }),
    );

    runAnalyze(["--for-hook", "claude", "--format", "json", "--workspace", wsRoot]);

    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout.join(""));
    expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(typeof out.hookSpecificOutput.additionalContext).toBe("string");
    expect(out.hookSpecificOutput.additionalContext.length).toBeGreaterThan(0);
    // CRITICAL: PostToolUse must NEVER emit permissionDecision (the tool already ran).
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
  });
});

describe("PostToolUse — clean workspace", () => {
  it("emits no envelope (empty stdout) and exits 0", () => {
    const { wsRoot, cleanFile } = setupCleanWorkspace();
    setAnalyzeStdin(() =>
      JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: cleanFile },
      }),
    );

    runAnalyze(["--for-hook", "claude", "--format", "json", "--workspace", wsRoot]);

    expect(exitCode).toBe(0);
    expect(stdout.join("").trim()).toBe("");
  });
});

describe("PostToolUse — malformed stdin (fail-soft, no envelope)", () => {
  it("non-JSON stdin → empty stdout + 006 stderr + exit 0 (NOT an allow envelope)", () => {
    const { wsRoot } = setupCleanWorkspace();
    setAnalyzeStdin(() => "not json at all");

    runAnalyze(["--for-hook", "claude", "--format", "json", "--workspace", wsRoot]);

    expect(exitCode).toBe(0);
    expect(stdout.join("").trim()).toBe("");
    expect(stderr.join("\n")).toContain("CHEM-INSTALL-HOOKS-006");
  });

  it("missing tool_input.file_path → empty stdout + 006 stderr + exit 0", () => {
    const { wsRoot } = setupCleanWorkspace();
    setAnalyzeStdin(() => JSON.stringify({ tool_name: "Edit", tool_input: {} }));

    runAnalyze(["--for-hook", "claude", "--format", "json", "--workspace", wsRoot]);

    expect(exitCode).toBe(0);
    expect(stdout.join("").trim()).toBe("");
    expect(stderr.join("\n")).toContain("CHEM-INSTALL-HOOKS-006");
  });
});
