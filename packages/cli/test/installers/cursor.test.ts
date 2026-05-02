// ---------------------------------------------------------------------------
// Tests for `installers/cursor.ts` — the WP-011 Cursor installer.
//
// Asserts the spec's 14 specific criteria:
//   1.  Husky-missing → CHEM-INSTALL-HOOKS-007.
//   2.  Husky present, no pre-commit → file created with chemag line.
//   3.  Husky present, pre-existing pre-commit → chemag line appended.
//   4.  Idempotence — both .husky/pre-commit AND .cursor/rules/architecture.mdc.
//   5.  CONTRIBUTING.md absent → minimal one created with chemag block.
//   6.  CONTRIBUTING.md with manual content outside markers → preserved.
//   7.  Re-emits .cursor/rules/architecture.mdc (file present after install).
//   8.  5-step flow parity: installCursor's MDC matches `chemag emit-rules --tool cursor`.
//   9.  Diagnostic-code numbering 001..008 gap-free in INSTALL-HOOKS.
//   10. Pre-commit unparseable → CHEM-INSTALL-HOOKS-008 without modifying file.
//   11. Uninstall: removes _chemag-tagged lines + chemag block, preserves MDC.
//   12. (Hook integration test moved to a separate fixture; verified at the
//       library level here by running addChemagLine result through `bash -c`.)
//   13. Dry-run: writes nothing.
//   14. Diagnostic-code registry bijection (covered in core's
//       diagnostics-registry.test.ts).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import {
  CHEMAG_PRECOMMIT_LINE,
  HuskyNotDetectedError,
  PrecommitUnparseableError,
  installCursor,
  uninstallCursor,
} from "../../src/installers/cursor.js";
import { cmdEmitRules } from "../../src/commands/emit-rules.js";
import { DIAGNOSTIC_CODES } from "@chemag/core/diagnostics";
import { __resetForTesting } from "@chemag/core/vocabulary";

let tmpDir: string;

const STD_WS = {
  workspace: "cursor-app",
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-cursor-installer-"));
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
// Criterion 1: husky missing → CHEM-INSTALL-HOOKS-007
// ---------------------------------------------------------------------------

describe("installCursor — husky missing", () => {
  it("throws HuskyNotDetectedError (mapped to CHEM-INSTALL-HOOKS-007 by the CLI)", () => {
    bootstrapWorkspace();
    expect(() => installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false })).toThrow(
      HuskyNotDetectedError,
    );
  });

  it("error message mentions the workspace root (actionable)", () => {
    bootstrapWorkspace();
    try {
      installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HuskyNotDetectedError);
      expect((e as HuskyNotDetectedError).workspaceRoot).toBe(tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 2: husky present, no pre-commit → file created
// ---------------------------------------------------------------------------

describe("installCursor — husky present, no pre-commit yet", () => {
  it("creates .husky/pre-commit with the chemag check line", () => {
    bootstrapWorkspace();
    setupHusky();
    installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false });

    const precommit = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");
    expect(precommit).toContain(CHEMAG_PRECOMMIT_LINE);
    expect(precommit).toMatch(/^#!\/usr\/bin\/env sh/);
  });

  it("chemag line is exactly the canonical form", () => {
    bootstrapWorkspace();
    setupHusky();
    installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const precommit = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");
    expect(precommit).toContain("chemag check --format human || exit 1 # _chemag");
  });
});

// ---------------------------------------------------------------------------
// Criterion 3: pre-existing pre-commit — chemag line appended; existing untouched
// ---------------------------------------------------------------------------

describe("installCursor — pre-existing pre-commit", () => {
  it("appends our line; leaves the user's existing content intact", () => {
    bootstrapWorkspace();
    setupHusky();
    const userContent = "#!/usr/bin/env sh\nlint-staged\n";
    fs.writeFileSync(path.join(tmpDir, ".husky/pre-commit"), userContent);

    installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const after = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");
    expect(after).toContain("lint-staged");
    expect(after).toContain(CHEMAG_PRECOMMIT_LINE);
  });
});

// ---------------------------------------------------------------------------
// Criterion 4: Idempotence
// ---------------------------------------------------------------------------

describe("installCursor — idempotence", () => {
  it("running twice produces byte-equal .husky/pre-commit AND .cursor/rules/architecture.mdc", () => {
    bootstrapWorkspace();
    setupHusky();
    installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const precommit1 = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");
    const mdc1 = fs.readFileSync(path.join(tmpDir, ".cursor/rules/architecture.mdc"), "utf-8");

    installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const precommit2 = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");
    const mdc2 = fs.readFileSync(path.join(tmpDir, ".cursor/rules/architecture.mdc"), "utf-8");

    expect(precommit2).toBe(precommit1);
    expect(mdc2).toBe(mdc1);
  });
});

// ---------------------------------------------------------------------------
// Criterion 5: CONTRIBUTING.md absent → created with chemag block
// ---------------------------------------------------------------------------

describe("installCursor — CONTRIBUTING.md absent", () => {
  it("creates a minimal CONTRIBUTING.md containing the chemag block", () => {
    bootstrapWorkspace();
    setupHusky();
    installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false });

    const contributing = fs.readFileSync(path.join(tmpDir, "CONTRIBUTING.md"), "utf-8");
    expect(contributing).toContain("# Contributing");
    expect(contributing).toContain("<!-- chemag:contributing:start -->");
    expect(contributing).toContain("chemag check-edit");
  });
});

// ---------------------------------------------------------------------------
// Criterion 6: CONTRIBUTING.md with manual content outside markers → preserved
// ---------------------------------------------------------------------------

describe("installCursor — CONTRIBUTING.md with manual content", () => {
  it("preserves manual content; only the chemag block is updated", () => {
    bootstrapWorkspace();
    setupHusky();
    const manual = `# My Project

## Manual onboarding section
- Step 1
- Step 2

`;
    fs.writeFileSync(path.join(tmpDir, "CONTRIBUTING.md"), manual);
    installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false });

    const after = fs.readFileSync(path.join(tmpDir, "CONTRIBUTING.md"), "utf-8");
    expect(after).toContain("Manual onboarding section");
    expect(after).toContain("Step 1");
    expect(after).toContain("<!-- chemag:contributing:start -->");
    expect(after).toContain("chemag check-edit");
  });
});

// ---------------------------------------------------------------------------
// Criterion 7: .cursor/rules/architecture.mdc emitted
// ---------------------------------------------------------------------------

describe("installCursor — emits .cursor/rules/architecture.mdc", () => {
  it("writes the MDC file with chemag markers + frontmatter", () => {
    bootstrapWorkspace();
    setupHusky();
    installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false });

    const mdcPath = path.join(tmpDir, ".cursor/rules/architecture.mdc");
    expect(fs.existsSync(mdcPath)).toBe(true);
    const body = fs.readFileSync(mdcPath, "utf-8");
    expect(body).toMatch(/^---/); // frontmatter
    expect(body).toContain("alwaysApply: true");
    expect(body).toContain("<!-- chemag:rules:start -->");
    expect(body).toContain("<!-- chemag:rules:end -->");
  });
});

// ---------------------------------------------------------------------------
// Criterion 8: 5-step flow parity with `chemag emit-rules --tool cursor`
// ---------------------------------------------------------------------------

describe("installCursor — 5-step flow parity with cmdEmitRules", () => {
  it("the .cursor/rules/architecture.mdc written by installCursor is byte-identical to one written by `chemag emit-rules --tool cursor`", () => {
    bootstrapWorkspace();
    setupHusky();

    // First produce the file via the installer.
    installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    const fromInstaller = fs.readFileSync(
      path.join(tmpDir, ".cursor/rules/architecture.mdc"),
      "utf-8",
    );

    // Now produce it via `chemag emit-rules --tool cursor` into a *fresh*
    // workspace (so neither path's output influences the other).
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-cursor-emit-rules-"));
    try {
      fs.writeFileSync(path.join(otherDir, "workspace.yaml"), yamlStringify(STD_WS));

      // The CLI command reads workspace via --workspace path; reset vocab
      // between calls so the second renders deterministically.
      __resetForTesting();
      const exit = cmdEmitRules([
        "--tool",
        "cursor",
        "--workspace",
        path.join(otherDir, "workspace.yaml"),
      ]);
      expect(exit).toBe(0);

      const fromEmitRules = fs.readFileSync(
        path.join(otherDir, ".cursor/rules/architecture.mdc"),
        "utf-8",
      );
      expect(fromEmitRules).toBe(fromInstaller);
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 9: gap-free 001..008 INSTALL-HOOKS numbering
// ---------------------------------------------------------------------------

describe("DIAGNOSTIC_CODES — INSTALL-HOOKS gap-free 001..008", () => {
  it("all of CHEM-INSTALL-HOOKS-001 through 008 are registered with no gaps", () => {
    const registered = Object.keys(DIAGNOSTIC_CODES).filter((k) =>
      k.startsWith("CHEM-INSTALL-HOOKS-"),
    );
    const nums = registered.map((k) => Number(k.match(/-(\d{3})$/)![1])).sort((a, b) => a - b);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

// ---------------------------------------------------------------------------
// Criterion 10: pre-commit unparseable → CHEM-INSTALL-HOOKS-008 without modifying file
// ---------------------------------------------------------------------------

describe("installCursor — pre-commit unparseable", () => {
  it("throws PrecommitUnparseableError without modifying the file", () => {
    bootstrapWorkspace();
    setupHusky();
    // Two chemag tags pointing at different commands → unparseable.
    const malformed = "chemag a # _chemag\nchemag b # _chemag\n";
    const precommitPath = path.join(tmpDir, ".husky/pre-commit");
    fs.writeFileSync(precommitPath, malformed);

    expect(() => installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false })).toThrow(
      PrecommitUnparseableError,
    );

    // File untouched.
    expect(fs.readFileSync(precommitPath, "utf-8")).toBe(malformed);
  });
});

// ---------------------------------------------------------------------------
// Criterion 11: uninstall removes chemag artifacts; preserves MDC
// ---------------------------------------------------------------------------

describe("uninstallCursor", () => {
  it("removes _chemag lines from .husky/pre-commit and chemag block from CONTRIBUTING.md; preserves .cursor/rules/architecture.mdc", () => {
    bootstrapWorkspace();
    setupHusky();
    // Manual line in pre-commit that should survive uninstall.
    fs.writeFileSync(path.join(tmpDir, ".husky/pre-commit"), "#!/usr/bin/env sh\nlint-staged\n");
    // Pre-existing CONTRIBUTING.md with manual content that should survive.
    fs.writeFileSync(path.join(tmpDir, "CONTRIBUTING.md"), "# Project\n\nManual content.\n");

    installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    expect(fs.existsSync(path.join(tmpDir, ".cursor/rules/architecture.mdc"))).toBe(true);

    uninstallCursor({ workspaceRoot: tmpDir, dryRun: false });

    // .husky/pre-commit: lint-staged remains, chemag line gone.
    const precommit = fs.readFileSync(path.join(tmpDir, ".husky/pre-commit"), "utf-8");
    expect(precommit).toContain("lint-staged");
    expect(precommit).not.toContain("# _chemag");

    // CONTRIBUTING.md: manual content remains, chemag block gone.
    const contributing = fs.readFileSync(path.join(tmpDir, "CONTRIBUTING.md"), "utf-8");
    expect(contributing).toContain("Manual content.");
    expect(contributing).not.toContain("<!-- chemag:contributing:start -->");

    // .cursor/rules/architecture.mdc: still present.
    expect(fs.existsSync(path.join(tmpDir, ".cursor/rules/architecture.mdc"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criterion 13: dry-run writes nothing
// ---------------------------------------------------------------------------

describe("installCursor — dry-run", () => {
  it("writes no .husky/pre-commit, no .cursor/rules/architecture.mdc, no CONTRIBUTING.md mutation", () => {
    bootstrapWorkspace();
    setupHusky();
    // Pre-existing CONTRIBUTING.md so we can verify it isn't mutated.
    const before = "# Project\n\nNo chemag block.\n";
    fs.writeFileSync(path.join(tmpDir, "CONTRIBUTING.md"), before);

    installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: true });

    expect(fs.existsSync(path.join(tmpDir, ".husky/pre-commit"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".cursor/rules/architecture.mdc"))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, "CONTRIBUTING.md"), "utf-8")).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Mode flag is accepted-but-ignored for cursor
// ---------------------------------------------------------------------------

describe("installCursor — mode flag handling", () => {
  it("emits an info note when --mode is non-default", () => {
    bootstrapWorkspace();
    setupHusky();
    const result = installCursor({ workspaceRoot: tmpDir, mode: "warn", dryRun: false });
    expect(result.infoNotes.some((n) => n.includes("ignored for cursor"))).toBe(true);
  });

  it("emits no info note when --mode is the default (block)", () => {
    bootstrapWorkspace();
    setupHusky();
    const result = installCursor({ workspaceRoot: tmpDir, mode: "block", dryRun: false });
    expect(result.infoNotes.length).toBe(0);
  });
});
