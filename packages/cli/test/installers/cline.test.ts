// ---------------------------------------------------------------------------
// Tests for `installers/cline.ts` — the WP-013 Cline installer.
//
// Mirrors the codex.test.ts shape, with one Cline-specific assertion: the
// post-install MCP tip is rendered via the SHARED parameterized vocabulary
// key `cli.install_hooks.tip.mcp_register` with `clientName: "Cline"`,
// `clientId: "cline"` (criterion 11).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import {
  CHEMAG_PRECOMMIT_LINE,
  HuskyNotDetectedError,
  installCline,
  uninstallCline,
} from "../../src/installers/cline.js";
import { cmdEmitRules } from "../../src/commands/emit-rules.js";
import { cmdInstallHooks } from "../../src/commands/install-hooks.js";
import { __resetForTesting } from "@chemag/core/vocabulary";

let tmpDir: string;

const STD_WS = {
  workspace: "cline-app",
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-cline-installer-"));
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

describe("installCline — emits .clinerules + .husky/pre-commit", () => {
  it("writes both artifacts on a clean fixture repo", () => {
    bootstrapWorkspace();
    setupHusky();
    installCline({ workspaceRoot: tmpDir, mode: "block", dryRun: false });

    const rulesPath = path.join(tmpDir, ".clinerules");
    expect(fs.existsSync(rulesPath)).toBe(true);
    const body = fs.readFileSync(rulesPath, "utf-8");
    expect(body).toContain("<!-- chemag:rules:start -->");
    expect(body).toContain("<!-- chemag:rules:end -->");
    expect(body).toContain("cline-app");

    const precommit = path.join(tmpDir, ".husky/pre-commit");
    expect(fs.existsSync(precommit)).toBe(true);
    expect(fs.readFileSync(precommit, "utf-8")).toContain(CHEMAG_PRECOMMIT_LINE);
  });
});

// ---------------------------------------------------------------------------
// Husky missing → CHEM-INSTALL-HOOKS-007
// ---------------------------------------------------------------------------

describe("installCline — husky missing", () => {
  it("throws HuskyNotDetectedError", () => {
    bootstrapWorkspace();
    expect(() => installCline({ workspaceRoot: tmpDir, mode: "block", dryRun: false })).toThrow(
      HuskyNotDetectedError,
    );
  });

  it("CLI surfaces CHEM-INSTALL-HOOKS-007", () => {
    bootstrapWorkspace();
    const stderr: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      stderr.push(a.join(" "));
    });
    try {
      const code = cmdInstallHooks(["--tool", "cline", "--workspace", tmpDir]);
      expect(code).toBe(2);
      expect(stderr.join("\n")).toContain("CHEM-INSTALL-HOOKS-007");
      expect(stderr.join("\n")).toContain("Husky not detected");
    } finally {
      errSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Idempotence
// ---------------------------------------------------------------------------

describe("installCline — idempotence", () => {
  it("running twice produces byte-equal artifacts", () => {
    bootstrapWorkspace();
    setupHusky();
    installCline({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const rules1 = fs.readFileSync(path.join(tmpDir, ".clinerules"), "utf-8");
    const precommit1 = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");

    installCline({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    expect(fs.readFileSync(path.join(tmpDir, ".clinerules"), "utf-8")).toBe(rules1);
    expect(fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8")).toBe(precommit1);
  });
});

// ---------------------------------------------------------------------------
// Existing .clinerules with manual content → preserved outside markers
// ---------------------------------------------------------------------------

describe("installCline — manual .clinerules content preserved", () => {
  it("preserves manual content; only chemag-managed block is updated", () => {
    bootstrapWorkspace();
    setupHusky();
    const manual = "# manual cline rules\n- write tests first\n\n";
    fs.writeFileSync(path.join(tmpDir, ".clinerules"), manual);
    installCline({ workspaceRoot: tmpDir, mode: "block", dryRun: false });

    const after = fs.readFileSync(path.join(tmpDir, ".clinerules"), "utf-8");
    expect(after).toContain("manual cline rules");
    expect(after).toContain("write tests first");
    expect(after).toContain("<!-- chemag:rules:start -->");
  });
});

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

describe("uninstallCline", () => {
  it("removes _chemag lines from .husky/pre-commit; preserves .clinerules", () => {
    bootstrapWorkspace();
    setupHusky();
    fs.writeFileSync(path.join(tmpDir, ".husky/pre-commit"), "#!/usr/bin/env sh\nlint-staged\n");

    installCline({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    expect(fs.existsSync(path.join(tmpDir, ".clinerules"))).toBe(true);

    uninstallCline({ workspaceRoot: tmpDir, dryRun: false });

    const precommit = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");
    expect(precommit).toContain("lint-staged");
    expect(precommit).not.toContain("# _chemag");
    expect(fs.existsSync(path.join(tmpDir, ".clinerules"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dry-run
// ---------------------------------------------------------------------------

describe("installCline — dry-run", () => {
  it("writes nothing", () => {
    bootstrapWorkspace();
    setupHusky();
    installCline({ workspaceRoot: tmpDir, mode: "block", dryRun: true });
    expect(fs.existsSync(path.join(tmpDir, ".clinerules"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".husky/pre-commit"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Criterion 11: Cline tip uses the shared key with clientName: "Cline"
// (and `clientId: "cline"` per the WP-012-extended params)
// ---------------------------------------------------------------------------

describe("cmdInstallHooks --tool cline — MCP tip rendering", () => {
  it("install summary contains 'Cline' (proper noun) and 'chemag mcp install --client cline'", () => {
    bootstrapWorkspace();
    setupHusky();

    const stdout: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      stdout.push(a.join(" "));
    });
    try {
      const code = cmdInstallHooks(["--tool", "cline", "--workspace", tmpDir]);
      expect(code).toBe(0);
      const text = stdout.join("\n");
      expect(text).toContain("Cline");
      expect(text).toContain("chemag mcp install --client cline");
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("installers/cline.ts — uses the shared MCP tip vocabulary key", () => {
  it('source references cli.install_hooks.tip.mcp_register with clientName: "Cline"', () => {
    // The tip is rendered by install-hooks.ts (the dispatcher), not cline.ts.
    // Per criterion 11 we still want grep-asserting that the call site uses
    // the shared key with `clientName: "Cline"` and that no parallel cline-
    // specific tip key was introduced. Search both files.
    const dispatcher = fs.readFileSync(
      path.resolve(__dirname, "../../src/commands/install-hooks.ts"),
      "utf-8",
    );
    const installer = fs.readFileSync(
      path.resolve(__dirname, "../../src/installers/cline.ts"),
      "utf-8",
    );
    const haystack = `${dispatcher}\n${installer}`;
    expect(haystack).toContain("cli.install_hooks.tip.mcp_register");
    expect(haystack).toContain('clientName: "Cline"');

    // No parallel cline-specific tip key.
    expect(haystack).not.toMatch(/cli\.install_hooks\.cline\.tip/);
  });
});

// ---------------------------------------------------------------------------
// Criterion 12: byte-parity with `chemag emit-rules --tool cline`
// ---------------------------------------------------------------------------

describe("installCline — byte-parity with cmdEmitRules --tool cline", () => {
  it(".clinerules byte-identical to one written by emit-rules", () => {
    bootstrapWorkspace();
    setupHusky();

    installCline({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const fromInstaller = fs.readFileSync(path.join(tmpDir, ".clinerules"), "utf-8");

    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-cline-emit-rules-"));
    try {
      fs.writeFileSync(path.join(otherDir, "workspace.yaml"), yamlStringify(STD_WS));
      __resetForTesting();
      const exit = cmdEmitRules([
        "--tool",
        "cline",
        "--workspace",
        path.join(otherDir, "workspace.yaml"),
      ]);
      expect(exit).toBe(0);
      const fromEmitRules = fs.readFileSync(path.join(otherDir, ".clinerules"), "utf-8");
      expect(fromEmitRules).toBe(fromInstaller);
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 10: no `cmdEmitRules` import in cline.ts
// ---------------------------------------------------------------------------

describe("installers/cline.ts source — no cmdEmitRules import", () => {
  it("the cline installer does NOT import cmdEmitRules from emit-rules.ts", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/installers/cline.ts"),
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
