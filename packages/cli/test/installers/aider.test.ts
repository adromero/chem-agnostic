// ---------------------------------------------------------------------------
// Tests for `installers/aider.ts` — the WP-013 Aider installer.
//
// Mirrors the codex.test.ts shape (same library-flow, same byte-parity
// guarantee). Adds Aider-specific assertions around `.aider.conf.yml`:
//   * .aider/CONVENTIONS.md emitted on install (markers + shared body).
//   * .aider.conf.yml gets a chemag block delimited by
//     `# chemag:aider:start` / `# chemag:aider:end`.
//   * Manual content in .aider.conf.yml outside the markers is preserved.
//   * Invalid YAML in .aider.conf.yml → CHEM-INSTALL-HOOKS-009; file
//     untouched.
//   * Idempotence over both files.
//   * Uninstall strips the chemag block from .aider.conf.yml and the
//     pre-commit line; preserves .aider/CONVENTIONS.md.
//   * No `cmdEmitRules` import (forbidden delegation, criterion 10).
//   * Byte-parity with `chemag emit-rules --tool aider` (criterion 12).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import {
  AIDER_CONF_MARKER_END,
  AIDER_CONF_MARKER_START,
  AiderConfInvalidYamlError,
  CHEMAG_PRECOMMIT_LINE,
  HuskyNotDetectedError,
  installAider,
  uninstallAider,
} from "../../src/installers/aider.js";
import { cmdEmitRules } from "../../src/commands/emit-rules.js";
import { cmdInstallHooks } from "../../src/commands/install-hooks.js";
import { __resetForTesting } from "@chemag/core/vocabulary";

let tmpDir: string;

const STD_WS = {
  workspace: "aider-app",
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-aider-installer-"));
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
// Criterion 1: each artifact is emitted on install
// ---------------------------------------------------------------------------

describe("installAider — emits .aider/CONVENTIONS.md, .aider.conf.yml, .husky/pre-commit", () => {
  it("writes all three artifacts on a clean fixture repo", () => {
    bootstrapWorkspace();
    setupHusky();
    installAider({ workspaceRoot: tmpDir, mode: "block", dryRun: false });

    const conventions = path.join(tmpDir, ".aider/CONVENTIONS.md");
    expect(fs.existsSync(conventions)).toBe(true);
    const conventionsBody = fs.readFileSync(conventions, "utf-8");
    expect(conventionsBody).toContain("<!-- chemag:rules:start -->");
    expect(conventionsBody).toContain("<!-- chemag:rules:end -->");
    expect(conventionsBody).toContain("aider-app");

    const conf = path.join(tmpDir, ".aider.conf.yml");
    expect(fs.existsSync(conf)).toBe(true);
    const confBody = fs.readFileSync(conf, "utf-8");
    expect(confBody).toContain(AIDER_CONF_MARKER_START);
    expect(confBody).toContain(AIDER_CONF_MARKER_END);
    expect(confBody).toContain("auto-commands");
    expect(confBody).toContain("chemag check-edit");

    const precommit = path.join(tmpDir, ".husky/pre-commit");
    expect(fs.existsSync(precommit)).toBe(true);
    expect(fs.readFileSync(precommit, "utf-8")).toContain(CHEMAG_PRECOMMIT_LINE);
  });
});

// ---------------------------------------------------------------------------
// Husky missing → CHEM-INSTALL-HOOKS-007
// ---------------------------------------------------------------------------

describe("installAider — husky missing", () => {
  it("throws HuskyNotDetectedError", () => {
    bootstrapWorkspace();
    expect(() => installAider({ workspaceRoot: tmpDir, mode: "block", dryRun: false })).toThrow(
      HuskyNotDetectedError,
    );
  });

  it("CLI surfaces CHEM-INSTALL-HOOKS-007 with diagnostic.husky_not_detected", () => {
    bootstrapWorkspace();
    const stderr: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      stderr.push(a.join(" "));
    });
    try {
      const code = cmdInstallHooks(["--tool", "aider", "--workspace", tmpDir]);
      expect(code).toBe(2);
      expect(stderr.join("\n")).toContain("CHEM-INSTALL-HOOKS-007");
      expect(stderr.join("\n")).toContain("Husky not detected");
    } finally {
      errSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 2: idempotence over all three artifacts
// ---------------------------------------------------------------------------

describe("installAider — idempotence", () => {
  it("running twice produces byte-equal artifacts", () => {
    bootstrapWorkspace();
    setupHusky();
    installAider({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const conv1 = fs.readFileSync(path.join(tmpDir, ".aider/CONVENTIONS.md"), "utf-8");
    const conf1 = fs.readFileSync(path.join(tmpDir, ".aider.conf.yml"), "utf-8");
    const precommit1 = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");

    installAider({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    expect(fs.readFileSync(path.join(tmpDir, ".aider/CONVENTIONS.md"), "utf-8")).toBe(conv1);
    expect(fs.readFileSync(path.join(tmpDir, ".aider.conf.yml"), "utf-8")).toBe(conf1);
    expect(fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8")).toBe(precommit1);
  });
});

// ---------------------------------------------------------------------------
// Criterion 3: pre-existing .aider.conf.yml with non-chemag content survives
// ---------------------------------------------------------------------------

describe("installAider — manual .aider.conf.yml content preserved", () => {
  it("appends chemag block; existing keys remain intact", () => {
    bootstrapWorkspace();
    setupHusky();
    const manual = `# user's aider config
auto-test: true
model: gpt-4o
`;
    fs.writeFileSync(path.join(tmpDir, ".aider.conf.yml"), manual);

    installAider({ workspaceRoot: tmpDir, mode: "block", dryRun: false });

    const after = fs.readFileSync(path.join(tmpDir, ".aider.conf.yml"), "utf-8");
    expect(after).toContain("auto-test: true");
    expect(after).toContain("model: gpt-4o");
    expect(after).toContain(AIDER_CONF_MARKER_START);
    expect(after).toContain(AIDER_CONF_MARKER_END);
  });
});

// ---------------------------------------------------------------------------
// Criterion 4: .aider.conf.yml invalid YAML → CHEM-INSTALL-HOOKS-009
// ---------------------------------------------------------------------------

describe("installAider — invalid .aider.conf.yml", () => {
  it("throws AiderConfInvalidYamlError; file is untouched", () => {
    bootstrapWorkspace();
    setupHusky();
    const broken = "key: value\n  bad indent: oops\n: : :\n";
    const confPath = path.join(tmpDir, ".aider.conf.yml");
    fs.writeFileSync(confPath, broken);

    expect(() => installAider({ workspaceRoot: tmpDir, mode: "block", dryRun: false })).toThrow(
      AiderConfInvalidYamlError,
    );

    // File is untouched.
    expect(fs.readFileSync(confPath, "utf-8")).toBe(broken);
  });

  it("CLI surfaces CHEM-INSTALL-HOOKS-009", () => {
    bootstrapWorkspace();
    setupHusky();
    fs.writeFileSync(
      path.join(tmpDir, ".aider.conf.yml"),
      "key: value\n  bad indent: oops\n: : :\n",
    );

    const stderr: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      stderr.push(a.join(" "));
    });
    try {
      const code = cmdInstallHooks(["--tool", "aider", "--workspace", tmpDir]);
      expect(code).toBe(2);
      expect(stderr.join("\n")).toContain("CHEM-INSTALL-HOOKS-009");
    } finally {
      errSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Uninstall — symmetric per tool; rule files preserved
// ---------------------------------------------------------------------------

describe("uninstallAider", () => {
  it("removes _chemag lines + chemag block from .aider.conf.yml; preserves CONVENTIONS.md", () => {
    bootstrapWorkspace();
    setupHusky();
    fs.writeFileSync(path.join(tmpDir, ".husky/pre-commit"), "#!/usr/bin/env sh\nlint-staged\n");
    fs.writeFileSync(path.join(tmpDir, ".aider.conf.yml"), "auto-test: true\n");

    installAider({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    expect(fs.existsSync(path.join(tmpDir, ".aider/CONVENTIONS.md"))).toBe(true);

    uninstallAider({ workspaceRoot: tmpDir, dryRun: false });

    const precommit = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");
    expect(precommit).toContain("lint-staged");
    expect(precommit).not.toContain("# _chemag");

    const conf = fs.readFileSync(path.join(tmpDir, ".aider.conf.yml"), "utf-8");
    expect(conf).toContain("auto-test: true");
    expect(conf).not.toContain(AIDER_CONF_MARKER_START);
    expect(conf).not.toContain(AIDER_CONF_MARKER_END);

    expect(fs.existsSync(path.join(tmpDir, ".aider/CONVENTIONS.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dry-run writes nothing
// ---------------------------------------------------------------------------

describe("installAider — dry-run", () => {
  it("writes no files", () => {
    bootstrapWorkspace();
    setupHusky();
    installAider({ workspaceRoot: tmpDir, mode: "block", dryRun: true });
    expect(fs.existsSync(path.join(tmpDir, ".husky/pre-commit"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".aider/CONVENTIONS.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".aider.conf.yml"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Criterion 12: byte-parity with `chemag emit-rules --tool aider`
// ---------------------------------------------------------------------------

describe("installAider — byte-parity with cmdEmitRules --tool aider", () => {
  it(".aider/CONVENTIONS.md byte-identical to one written by emit-rules", () => {
    bootstrapWorkspace();
    setupHusky();

    installAider({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const fromInstaller = fs.readFileSync(path.join(tmpDir, ".aider/CONVENTIONS.md"), "utf-8");

    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-aider-emit-rules-"));
    try {
      fs.writeFileSync(path.join(otherDir, "workspace.yaml"), yamlStringify(STD_WS));
      __resetForTesting();
      const exit = cmdEmitRules([
        "--tool",
        "aider",
        "--workspace",
        path.join(otherDir, "workspace.yaml"),
      ]);
      expect(exit).toBe(0);
      const fromEmitRules = fs.readFileSync(path.join(otherDir, ".aider/CONVENTIONS.md"), "utf-8");
      expect(fromEmitRules).toBe(fromInstaller);
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 10: no `cmdEmitRules` import in aider.ts
// ---------------------------------------------------------------------------

describe("installers/aider.ts source — no cmdEmitRules import", () => {
  it("the aider installer does NOT import cmdEmitRules from emit-rules.ts", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/installers/aider.ts"),
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
