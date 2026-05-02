// ---------------------------------------------------------------------------
// Tests for `installers/codex.ts` — the WP-012 Codex installer.
//
// Asserts the spec's 11 specific criteria:
//   1.  AGENTS.md emitted on install (markers + shared body).
//   2.  Husky missing → HuskyNotDetectedError → CHEM-INSTALL-HOOKS-007 with
//       trKey `diagnostic.husky_not_detected`.
//   3.  Tool-agnostic husky message — no "cursor", no "codex" in either
//       vocabulary's rendered text.
//   4.  Idempotence — repeat install produces byte-equal AGENTS.md and
//       .husky/pre-commit.
//   5.  Existing AGENTS.md with manual content is preserved (only the
//       chemag-managed block is updated).
//   6.  Uninstall removes _chemag lines from .husky/pre-commit and does NOT
//       delete AGENTS.md.
//   7.  Dry-run writes nothing.
//   8.  Byte-parity with `chemag emit-rules --tool codex`.
//   9.  MCP-tip rendering ("Codex" + "chemag mcp install --client codex").
//   10. Help snapshot for `--tool codex --help` (uses cli.install_hooks.codex.help).
//   11. No `cmdEmitRules` import in codex.ts (forbidden delegation).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import {
  CHEMAG_PRECOMMIT_LINE,
  HuskyNotDetectedError,
  installCodex,
  uninstallCodex,
} from "../../src/installers/codex.js";
import { cmdEmitRules } from "../../src/commands/emit-rules.js";
import { cmdInstallHooks } from "../../src/commands/install-hooks.js";
import { __resetForTesting, setVocabulary, tr } from "@chemag/core/vocabulary";

let tmpDir: string;

const STD_WS = {
  workspace: "codex-app",
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-codex-installer-"));
  __resetForTesting();
  // Silence install-time stdout/stderr unless a test explicitly asserts on them.
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
// Criterion 1: AGENTS.md emitted on install
// ---------------------------------------------------------------------------

describe("installCodex — emits AGENTS.md", () => {
  it("writes AGENTS.md at workspace root with chemag-block markers + shared body", () => {
    bootstrapWorkspace();
    setupHusky();
    installCodex({ workspaceRoot: tmpDir, mode: "block", dryRun: false });

    const agentsPath = path.join(tmpDir, "AGENTS.md");
    expect(fs.existsSync(agentsPath)).toBe(true);
    const body = fs.readFileSync(agentsPath, "utf-8");
    expect(body).toContain("<!-- chemag:rules:start -->");
    expect(body).toContain("<!-- chemag:rules:end -->");
    // Shared body is built from the workspace name + dependency-rule table.
    expect(body).toContain("codex-app");
  });
});

// ---------------------------------------------------------------------------
// Criterion 2: husky missing → HuskyNotDetectedError → CHEM-INSTALL-HOOKS-007
// ---------------------------------------------------------------------------

describe("installCodex — husky missing", () => {
  it("throws HuskyNotDetectedError (mapped to CHEM-INSTALL-HOOKS-007 by the CLI)", () => {
    bootstrapWorkspace();
    expect(() => installCodex({ workspaceRoot: tmpDir, mode: "block", dryRun: false })).toThrow(
      HuskyNotDetectedError,
    );
  });

  it("CLI surfaces CHEM-INSTALL-HOOKS-007 with trKey diagnostic.husky_not_detected", () => {
    // Run cmdInstallHooks --tool codex on a workspace without husky → expect
    // exit 2 and the husky-not-detected text on stderr.
    bootstrapWorkspace();
    const stderr: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      stderr.push(a.join(" "));
    });
    try {
      const code = cmdInstallHooks(["--tool", "codex", "--workspace", tmpDir]);
      expect(code).toBe(2);
      expect(stderr.join("\n")).toContain("CHEM-INSTALL-HOOKS-007");
      // The renamed key is rendered.
      expect(stderr.join("\n")).toContain("Husky not detected");
    } finally {
      errSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 3: tool-agnostic husky message — no "cursor", no "codex"
// ---------------------------------------------------------------------------

describe("installCodex — husky-not-detected message is tool-agnostic", () => {
  for (const vocab of ["standard", "chemistry"] as const) {
    it(`${vocab}: rendered text contains neither "cursor" nor "codex" (case-insensitive)`, () => {
      __resetForTesting();
      setVocabulary(vocab, "flag");
      const rendered = tr("diagnostic.husky_not_detected", { workspace: "/tmp/x" });
      expect(rendered.toLowerCase()).not.toContain("cursor");
      expect(rendered.toLowerCase()).not.toContain("codex");
      // Sanity: we still mention husky.
      expect(rendered.toLowerCase()).toContain("husky");
    });
  }
});

// ---------------------------------------------------------------------------
// Criterion 4: idempotence
// ---------------------------------------------------------------------------

describe("installCodex — idempotence", () => {
  it("running twice produces byte-equal .husky/pre-commit AND AGENTS.md", () => {
    bootstrapWorkspace();
    setupHusky();
    installCodex({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const precommit1 = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");
    const agents1 = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");

    installCodex({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const precommit2 = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");
    const agents2 = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");

    expect(precommit2).toBe(precommit1);
    expect(agents2).toBe(agents1);
  });
});

// ---------------------------------------------------------------------------
// Criterion 5: existing AGENTS.md with manual content → preserved outside markers
// ---------------------------------------------------------------------------

describe("installCodex — existing AGENTS.md with manual content", () => {
  it("preserves manual content; only the chemag-managed block is updated", () => {
    bootstrapWorkspace();
    setupHusky();
    const manual = `# AGENTS

This file documents how AI agents should interact with this repo.

## Manual onboarding section
- Step 1
- Step 2

`;
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), manual);
    installCodex({ workspaceRoot: tmpDir, mode: "block", dryRun: false });

    const after = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(after).toContain("Manual onboarding section");
    expect(after).toContain("Step 1");
    expect(after).toContain("<!-- chemag:rules:start -->");
    expect(after).toContain("<!-- chemag:rules:end -->");
  });
});

// ---------------------------------------------------------------------------
// Criterion 6: uninstall removes pre-commit line; does NOT delete AGENTS.md
// ---------------------------------------------------------------------------

describe("uninstallCodex", () => {
  it("removes _chemag lines from .husky/pre-commit; preserves AGENTS.md", () => {
    bootstrapWorkspace();
    setupHusky();
    fs.writeFileSync(path.join(tmpDir, ".husky/pre-commit"), "#!/usr/bin/env sh\nlint-staged\n");

    installCodex({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    expect(fs.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(true);

    uninstallCodex({ workspaceRoot: tmpDir, dryRun: false });

    // .husky/pre-commit: lint-staged remains, chemag line gone.
    const precommit = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");
    expect(precommit).toContain("lint-staged");
    expect(precommit).not.toContain("# _chemag");

    // AGENTS.md: still present.
    expect(fs.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criterion 7: dry-run writes nothing
// ---------------------------------------------------------------------------

describe("installCodex — dry-run", () => {
  it("writes no .husky/pre-commit, no AGENTS.md mutation", () => {
    bootstrapWorkspace();
    setupHusky();
    // Pre-existing AGENTS.md so we can verify it isn't mutated.
    const before = "# AGENTS\n\nNo chemag block.\n";
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), before);

    installCodex({ workspaceRoot: tmpDir, mode: "block", dryRun: true });

    expect(fs.existsSync(path.join(tmpDir, ".husky/pre-commit"))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8")).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Criterion 8: byte-parity with `chemag emit-rules --tool codex`
// ---------------------------------------------------------------------------

describe("installCodex — 5-step flow parity with cmdEmitRules --tool codex", () => {
  it("AGENTS.md byte-identical to one written by `chemag emit-rules --tool codex`", () => {
    bootstrapWorkspace();
    setupHusky();

    // First produce the file via the installer.
    installCodex({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const fromInstaller = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");

    // Now produce it via `chemag emit-rules --tool codex` into a fresh workspace.
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-codex-emit-rules-"));
    try {
      fs.writeFileSync(path.join(otherDir, "workspace.yaml"), yamlStringify(STD_WS));

      __resetForTesting();
      const exit = cmdEmitRules([
        "--tool",
        "codex",
        "--workspace",
        path.join(otherDir, "workspace.yaml"),
      ]);
      expect(exit).toBe(0);

      const fromEmitRules = fs.readFileSync(path.join(otherDir, "AGENTS.md"), "utf-8");
      expect(fromEmitRules).toBe(fromInstaller);
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 9: MCP-tip rendering
// ---------------------------------------------------------------------------

describe("cmdInstallHooks --tool codex — MCP tip rendering", () => {
  it("install summary contains 'Codex' and 'chemag mcp install --client codex'", () => {
    bootstrapWorkspace();
    setupHusky();

    const stdout: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      stdout.push(a.join(" "));
    });
    try {
      const code = cmdInstallHooks(["--tool", "codex", "--workspace", tmpDir]);
      expect(code).toBe(0);
      const text = stdout.join("\n");
      expect(text).toContain("Codex");
      expect(text).toContain("chemag mcp install --client codex");
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 10: help blurb uses cli.install_hooks.codex.help (vocabulary key
// exists in both locales)
// ---------------------------------------------------------------------------

describe("cli.install_hooks.codex.help vocabulary entry", () => {
  for (const vocab of ["standard", "chemistry"] as const) {
    it(`${vocab}: tr("cli.install_hooks.codex.help") renders a non-empty string mentioning codex`, () => {
      __resetForTesting();
      setVocabulary(vocab, "flag");
      const blurb = tr("cli.install_hooks.codex.help");
      expect(blurb.length).toBeGreaterThan(0);
      expect(blurb.toLowerCase()).toContain("codex");
      expect(blurb.toLowerCase()).toContain("agents.md");
    });
  }
});

// ---------------------------------------------------------------------------
// Criterion 11: no `cmdEmitRules` import in codex.ts (forbidden delegation)
// ---------------------------------------------------------------------------

describe("installers/codex.ts source — no cmdEmitRules import", () => {
  it("the codex installer does NOT import cmdEmitRules from emit-rules.ts", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/installers/codex.ts"),
      "utf-8",
    );
    // Strip line-comments before scanning so the rationale comment block
    // (which mentions `cmdEmitRules` to explain why we DON'T delegate to
    // it) doesn't trigger a false positive. We then look for actual import
    // statements / call sites.
    const stripped = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    // Forbidden: any actual import statement or call referencing cmdEmitRules.
    expect(stripped).not.toMatch(/\bimport\b[^;]*\bcmdEmitRules\b/);
    expect(stripped).not.toMatch(/\bcmdEmitRules\s*\(/);
    expect(stripped).not.toMatch(/from\s+["']\.\.\/commands\/emit-rules/);
  });
});

// ---------------------------------------------------------------------------
// Mode flag is accepted-but-ignored for codex (mirrors cursor)
// ---------------------------------------------------------------------------

describe("installCodex — mode flag handling", () => {
  it("emits an info note when --mode is non-default", () => {
    bootstrapWorkspace();
    setupHusky();
    const result = installCodex({ workspaceRoot: tmpDir, mode: "warn", dryRun: false });
    expect(result.infoNotes.some((n) => n.includes("ignored for codex"))).toBe(true);
  });

  it("emits no info note when --mode is the default (block)", () => {
    bootstrapWorkspace();
    setupHusky();
    const result = installCodex({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    expect(result.infoNotes.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Husky pre-commit canonical line (parity with cursor.ts)
// ---------------------------------------------------------------------------

describe("installCodex — pre-commit line is canonical", () => {
  it("appends the exact chemag-tagged check line", () => {
    bootstrapWorkspace();
    setupHusky();
    installCodex({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const precommit = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");
    expect(precommit).toContain(CHEMAG_PRECOMMIT_LINE);
    expect(precommit).toContain("chemag check --format human || exit 1 # _chemag");
  });
});
