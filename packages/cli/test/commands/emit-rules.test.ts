// ---------------------------------------------------------------------------
// CLI integration tests for `chemag emit-rules`. Covers --dry-run, --diff,
// --include-violations, --tool all, --tool codex (alias for agents),
// idempotence (re-run produces zero diff), and the markers-missing error.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { __resetForTesting } from "@chemag/core/vocabulary";
import { cmdEmitRules } from "../../src/commands/emit-rules.js";

let tmpDir: string;
let stdout: string[];
let stderr: string[];
let warnings: string[];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-emit-rules-"));
  __resetForTesting();
  stdout = [];
  stderr = [];
  warnings = [];

  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
    warnings.push(a.join(" "));
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  __resetForTesting();
});

function writeFixtureWorkspace(): string {
  const wsPath = path.join(tmpDir, "workspace.yaml");
  fs.writeFileSync(
    wsPath,
    yamlStringify({
      workspace: "fixtureapp",
      language: "typescript",
      roles: {
        element: { description: "value", folder: "elements" },
        molecule: { description: "state", folder: "molecules" },
        reaction: { description: "use case", folder: "reactions" },
        interface: { description: "port", folder: "interfaces" },
        adapter: { description: "concrete", folder: "adapters" },
        buffer: { description: "middleware", folder: "buffers" },
      },
      bonds: {
        element: ["element"],
        molecule: ["element", "molecule"],
        reaction: ["element", "molecule", "interface"],
        interface: ["element", "molecule"],
        adapter: ["element", "molecule", "interface", "adapter"],
        buffer: ["element", "molecule", "interface"],
      },
      paths: { compounds: "./src/compounds" },
      rules: {
        cross_compound_imports: "public_only",
        public_surface: "public.ts",
        manifest_filename: "compound.yaml",
      },
    }),
  );
  return wsPath;
}

describe("cmdEmitRules — --dry-run", () => {
  it("writes nothing and prints planned actions", () => {
    const wsPath = writeFixtureWorkspace();
    const code = cmdEmitRules(["--workspace", wsPath, "--dry-run"]);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "CLAUDE.md"))).toBe(false);
    expect(stdout.join("\n")).toContain("AGENTS.md");
    expect(stdout.join("\n")).toContain("CLAUDE.md");
  });
});

describe("cmdEmitRules — --tool all", () => {
  it("emits one file per supported tool", () => {
    const wsPath = writeFixtureWorkspace();
    const code = cmdEmitRules(["--workspace", wsPath, "--tool", "all"]);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "CLAUDE.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".cursor/rules/architecture.mdc"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".github/copilot-instructions.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".aider/CONVENTIONS.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".clinerules"))).toBe(true);
  });
});

describe("cmdEmitRules — --tool codex aliases to AGENTS.md", () => {
  it("only writes AGENTS.md when --tool codex is given", () => {
    const wsPath = writeFixtureWorkspace();
    const code = cmdEmitRules(["--workspace", wsPath, "--tool", "codex"]);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "CLAUDE.md"))).toBe(false);
  });
});

describe("cmdEmitRules — unknown tool", () => {
  it("returns non-zero and emits CHEM-EMIT-RULES-003", () => {
    const wsPath = writeFixtureWorkspace();
    const code = cmdEmitRules(["--workspace", wsPath, "--tool", "bogus"]);
    expect(code).toBe(2);
    expect(stderr.join("\n")).toContain("CHEM-EMIT-RULES-003");
    expect(stderr.join("\n")).toContain("bogus");
  });
});

describe("cmdEmitRules — idempotence", () => {
  it("running twice produces byte-identical files", () => {
    const wsPath = writeFixtureWorkspace();
    expect(cmdEmitRules(["--workspace", wsPath, "--tool", "agents"])).toBe(0);
    const first = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(cmdEmitRules(["--workspace", wsPath, "--tool", "agents"])).toBe(0);
    const second = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(second).toBe(first);
  });
});

describe("cmdEmitRules — markers missing without --overwrite", () => {
  it("returns non-zero and emits CHEM-EMIT-RULES-001", () => {
    const wsPath = writeFixtureWorkspace();
    const target = path.join(tmpDir, "AGENTS.md");
    fs.writeFileSync(target, "# manually authored, no markers\n");

    const code = cmdEmitRules(["--workspace", wsPath, "--tool", "agents"]);
    expect(code).toBe(1);
    expect(stderr.join("\n")).toContain("CHEM-EMIT-RULES-001");
    // File must NOT have been touched.
    expect(fs.readFileSync(target, "utf-8")).toBe("# manually authored, no markers\n");
  });

  it("succeeds with --overwrite and replaces the file", () => {
    const wsPath = writeFixtureWorkspace();
    const target = path.join(tmpDir, "AGENTS.md");
    fs.writeFileSync(target, "# manually authored, no markers\n");

    const code = cmdEmitRules(["--workspace", wsPath, "--tool", "agents", "--overwrite"]);
    expect(code).toBe(0);
    const next = fs.readFileSync(target, "utf-8");
    expect(next).not.toContain("# manually authored, no markers");
    expect(next).toContain("<!-- chemag:rules:start -->");
  });
});

describe("cmdEmitRules — manual content outside markers survives", () => {
  it("user notes around the markers are preserved on re-emit", () => {
    const wsPath = writeFixtureWorkspace();
    expect(cmdEmitRules(["--workspace", wsPath, "--tool", "agents"])).toBe(0);
    const target = path.join(tmpDir, "AGENTS.md");
    let body = fs.readFileSync(target, "utf-8");

    // Inject manual content before and after the markers.
    body = `# user note before\n\n${body}\n# user note after\n`;
    fs.writeFileSync(target, body);

    expect(cmdEmitRules(["--workspace", wsPath, "--tool", "agents"])).toBe(0);
    const next = fs.readFileSync(target, "utf-8");
    expect(next).toContain("# user note before");
    expect(next).toContain("# user note after");
  });
});

describe("cmdEmitRules — --include-violations", () => {
  it("embeds violation hints when the workspace has any", () => {
    const wsPath = writeFixtureWorkspace();
    // Make a structurally-broken compound to produce a diagnostic.
    const compoundDir = path.join(tmpDir, "src/compounds/billing");
    fs.mkdirSync(compoundDir, { recursive: true });
    fs.writeFileSync(
      path.join(compoundDir, "compound.yaml"),
      yamlStringify({
        compound: "billing",
        type: "compound",
        units: [
          // role "ghost" is not in workspace.roles → CHEM-ROLE-001
          { role: "ghost", name: "Phantom", file: "elements/Phantom.ts" },
        ],
      }),
    );

    const code = cmdEmitRules(["--workspace", wsPath, "--tool", "agents", "--include-violations"]);
    expect(code).toBe(0);
    const body = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(body).toContain("Current violations");
    expect(body).toMatch(/CHEM-ROLE-001/);
  });
});

describe("cmdEmitRules — --diff", () => {
  it("prints a unified diff for files that would change and writes nothing", () => {
    const wsPath = writeFixtureWorkspace();
    // Pre-populate so --diff has something to compare against.
    expect(cmdEmitRules(["--workspace", wsPath, "--tool", "agents"])).toBe(0);
    const target = path.join(tmpDir, "AGENTS.md");
    const initial = fs.readFileSync(target, "utf-8");

    // Tamper with the file body so the next run would produce a diff.
    fs.writeFileSync(target, initial.replace("Architecture summary", "Architecture SUMMARY"));

    stdout = [];
    expect(cmdEmitRules(["--workspace", wsPath, "--tool", "agents", "--diff"])).toBe(0);
    const printed = stdout.join("\n");
    expect(printed).toMatch(/^---/m);
    expect(printed).toMatch(/^\+\+\+/m);
    // File should not have been overwritten by --diff.
    const after = fs.readFileSync(target, "utf-8");
    expect(after).toBe(initial.replace("Architecture summary", "Architecture SUMMARY"));
  });
});
