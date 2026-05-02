// ---------------------------------------------------------------------------
// Tests for `installers/copilot.ts` — the WP-013 GitHub Copilot installer.
//
// Covers:
//   * .github/copilot-instructions.md emitted on install (markers + body).
//   * .github/workflows/chemag-pr.yml emitted on install (chemag header).
//   * .husky/pre-commit chemag line installed.
//   * Idempotence over all three artifacts.
//   * Pre-existing chemag-pr.yml WITHOUT the chemag header → CHEM-INSTALL-
//     HOOKS-010 unless --overwrite.
//   * Uninstall removes only the chemag-tagged artifacts; preserves
//     copilot-instructions.md.
//   * Dry-run writes nothing.
//   * No `cmdEmitRules` import (criterion 10).
//   * Byte-parity with `chemag emit-rules --tool copilot` (criterion 12).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import {
  CHEMAG_PR_WORKFLOW_HEADER,
  CHEMAG_PRECOMMIT_LINE,
  CopilotWorkflowExistsNoOverwriteError,
  HuskyNotDetectedError,
  installCopilot,
  uninstallCopilot,
} from "../../src/installers/copilot.js";
import { cmdEmitRules } from "../../src/commands/emit-rules.js";
import { cmdInstallHooks } from "../../src/commands/install-hooks.js";
import { __resetForTesting } from "@chemag/core/vocabulary";

let tmpDir: string;

const STD_WS = {
  workspace: "copilot-app",
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
  paths: { compounds: "src/compounds" },
  rules: {
    cross_compound_imports: "public_only",
    role_from_path: true,
    public_surface: "public.ts",
    manifest_filename: "compound.yaml",
  },
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-copilot-installer-"));
  __resetForTesting();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  __resetForTesting();
});

function bootstrapWorkspace(): void {
  fs.writeFileSync(path.join(tmpDir, "workspace.yaml"), yamlStringify(STD_WS));
}

function setupHusky(): void {
  fs.mkdirSync(path.join(tmpDir, ".husky"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify({ name: "x", devDependencies: { husky: "^9.0.0" } }),
  );
}

// ---------------------------------------------------------------------------
// Criterion 1: artifacts emitted on install
// ---------------------------------------------------------------------------

describe("installCopilot — emits all artifacts", () => {
  it("writes copilot-instructions.md, chemag-pr.yml, and pre-commit", () => {
    bootstrapWorkspace();
    setupHusky();
    installCopilot({ workspaceRoot: tmpDir, mode: "block", dryRun: false });

    const instructions = path.join(tmpDir, ".github/copilot-instructions.md");
    expect(fs.existsSync(instructions)).toBe(true);
    const ibody = fs.readFileSync(instructions, "utf-8");
    expect(ibody).toContain("<!-- chemag:rules:start -->");
    expect(ibody).toContain("<!-- chemag:rules:end -->");
    expect(ibody).toContain("copilot-app");

    const wf = path.join(tmpDir, ".github/workflows/chemag-pr.yml");
    expect(fs.existsSync(wf)).toBe(true);
    const wfBody = fs.readFileSync(wf, "utf-8");
    expect(wfBody.startsWith(CHEMAG_PR_WORKFLOW_HEADER)).toBe(true);
    expect(wfBody).toContain("chemag check");
    expect(wfBody).toContain("chemag analyze");

    const precommit = path.join(tmpDir, ".husky/pre-commit");
    expect(fs.existsSync(precommit)).toBe(true);
    expect(fs.readFileSync(precommit, "utf-8")).toContain(CHEMAG_PRECOMMIT_LINE);
  });
});

// ---------------------------------------------------------------------------
// Husky missing → CHEM-INSTALL-HOOKS-007
// ---------------------------------------------------------------------------

describe("installCopilot — husky missing", () => {
  it("throws HuskyNotDetectedError", () => {
    bootstrapWorkspace();
    expect(() => installCopilot({ workspaceRoot: tmpDir, mode: "block", dryRun: false })).toThrow(
      HuskyNotDetectedError,
    );
  });
});

// ---------------------------------------------------------------------------
// Idempotence
// ---------------------------------------------------------------------------

describe("installCopilot — idempotence", () => {
  it("running twice produces byte-equal artifacts", () => {
    bootstrapWorkspace();
    setupHusky();
    installCopilot({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const i1 = fs.readFileSync(path.join(tmpDir, ".github/copilot-instructions.md"), "utf-8");
    const w1 = fs.readFileSync(path.join(tmpDir, ".github/workflows/chemag-pr.yml"), "utf-8");
    const p1 = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");

    installCopilot({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    expect(fs.readFileSync(path.join(tmpDir, ".github/copilot-instructions.md"), "utf-8")).toBe(i1);
    expect(fs.readFileSync(path.join(tmpDir, ".github/workflows/chemag-pr.yml"), "utf-8")).toBe(w1);
    expect(fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8")).toBe(p1);
  });
});

// ---------------------------------------------------------------------------
// Criterion 5: chemag-pr.yml exists without the chemag header → CHEM-INSTALL-
// HOOKS-010 unless --overwrite
// ---------------------------------------------------------------------------

describe("installCopilot — pre-existing chemag-pr.yml without chemag header", () => {
  it("throws CopilotWorkflowExistsNoOverwriteError without --overwrite", () => {
    bootstrapWorkspace();
    setupHusky();
    const wfPath = path.join(tmpDir, ".github/workflows/chemag-pr.yml");
    fs.mkdirSync(path.dirname(wfPath), { recursive: true });
    fs.writeFileSync(
      wfPath,
      "name: my-pr-workflow\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n",
    );

    expect(() => installCopilot({ workspaceRoot: tmpDir, mode: "block", dryRun: false })).toThrow(
      CopilotWorkflowExistsNoOverwriteError,
    );

    // File untouched.
    expect(fs.readFileSync(wfPath, "utf-8")).not.toContain(CHEMAG_PR_WORKFLOW_HEADER);
  });

  it("overwrites when --overwrite is passed", () => {
    bootstrapWorkspace();
    setupHusky();
    const wfPath = path.join(tmpDir, ".github/workflows/chemag-pr.yml");
    fs.mkdirSync(path.dirname(wfPath), { recursive: true });
    fs.writeFileSync(wfPath, "name: my-pr-workflow\n");

    installCopilot({ workspaceRoot: tmpDir, mode: "block", dryRun: false, overwrite: true });

    const after = fs.readFileSync(wfPath, "utf-8");
    expect(after.startsWith(CHEMAG_PR_WORKFLOW_HEADER)).toBe(true);
  });

  it("CLI surfaces CHEM-INSTALL-HOOKS-010", () => {
    bootstrapWorkspace();
    setupHusky();
    const wfPath = path.join(tmpDir, ".github/workflows/chemag-pr.yml");
    fs.mkdirSync(path.dirname(wfPath), { recursive: true });
    fs.writeFileSync(wfPath, "name: my-pr-workflow\n");

    const stderr: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      stderr.push(a.join(" "));
    });
    try {
      const code = cmdInstallHooks(["--tool", "copilot", "--workspace", tmpDir]);
      expect(code).toBe(2);
      expect(stderr.join("\n")).toContain("CHEM-INSTALL-HOOKS-010");
    } finally {
      errSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Uninstall — preserves copilot-instructions.md, removes only chemag-tagged
// workflow files
// ---------------------------------------------------------------------------

describe("uninstallCopilot", () => {
  it("removes chemag pre-commit line + chemag-pr.yml; preserves copilot-instructions.md", () => {
    bootstrapWorkspace();
    setupHusky();
    fs.writeFileSync(path.join(tmpDir, ".husky/pre-commit"), "#!/usr/bin/env sh\nlint-staged\n");

    installCopilot({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    expect(fs.existsSync(path.join(tmpDir, ".github/copilot-instructions.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".github/workflows/chemag-pr.yml"))).toBe(true);

    uninstallCopilot({ workspaceRoot: tmpDir, dryRun: false });

    const precommit = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");
    expect(precommit).toContain("lint-staged");
    expect(precommit).not.toContain("# _chemag");

    expect(fs.existsSync(path.join(tmpDir, ".github/copilot-instructions.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".github/workflows/chemag-pr.yml"))).toBe(false);
  });

  it("preserves user-authored chemag-pr.yml without the chemag header", () => {
    bootstrapWorkspace();
    setupHusky();
    const wfPath = path.join(tmpDir, ".github/workflows/chemag-pr.yml");
    fs.mkdirSync(path.dirname(wfPath), { recursive: true });
    const userBody = "name: my-pr-workflow\n";
    fs.writeFileSync(wfPath, userBody);

    uninstallCopilot({ workspaceRoot: tmpDir, dryRun: false });

    expect(fs.existsSync(wfPath)).toBe(true);
    expect(fs.readFileSync(wfPath, "utf-8")).toBe(userBody);
  });
});

// ---------------------------------------------------------------------------
// Dry-run
// ---------------------------------------------------------------------------

describe("installCopilot — dry-run", () => {
  it("writes nothing", () => {
    bootstrapWorkspace();
    setupHusky();
    installCopilot({ workspaceRoot: tmpDir, mode: "block", dryRun: true });
    expect(fs.existsSync(path.join(tmpDir, ".github/copilot-instructions.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".github/workflows/chemag-pr.yml"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".husky/pre-commit"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Criterion 12: byte-parity with `chemag emit-rules --tool copilot`
// ---------------------------------------------------------------------------

describe("installCopilot — byte-parity with cmdEmitRules --tool copilot", () => {
  it(".github/copilot-instructions.md byte-identical to one written by emit-rules", () => {
    bootstrapWorkspace();
    setupHusky();

    installCopilot({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const fromInstaller = fs.readFileSync(
      path.join(tmpDir, ".github/copilot-instructions.md"),
      "utf-8",
    );

    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-copilot-emit-rules-"));
    try {
      fs.writeFileSync(path.join(otherDir, "workspace.yaml"), yamlStringify(STD_WS));
      __resetForTesting();
      const exit = cmdEmitRules([
        "--tool",
        "copilot",
        "--workspace",
        path.join(otherDir, "workspace.yaml"),
      ]);
      expect(exit).toBe(0);
      const fromEmitRules = fs.readFileSync(
        path.join(otherDir, ".github/copilot-instructions.md"),
        "utf-8",
      );
      expect(fromEmitRules).toBe(fromInstaller);
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 10: no `cmdEmitRules` import in copilot.ts
// ---------------------------------------------------------------------------

describe("installers/copilot.ts source — no cmdEmitRules import", () => {
  it("the copilot installer does NOT import cmdEmitRules from emit-rules.ts", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/installers/copilot.ts"),
      "utf-8",
    );
    const stripped = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(stripped).not.toMatch(/\bimport\b[^;]*\bcmdEmitRules\b/);
    expect(stripped).not.toMatch(/\bcmdEmitRules\s*\(/);
    expect(stripped).not.toMatch(/from\s+["']\.\.\/commands\/emit-rules/);
  });
});
