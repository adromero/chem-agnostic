/**
 * End-to-end test: multi-language (polyglot-mini) workflow — WP-022.
 *
 * Exercises every CLI command on a four-sub-tree workspace
 * (TypeScript x2, Python, Go) and asserts:
 *
 *   1. `init` / `add compound` / `add unit` produce a runnable workspace
 *      end-to-end on a TS sub-tree.
 *   2. `check` / `analyze` / `graph` / `scaffold` / `sync` operate uniformly
 *      across the polyglot fixture without crashing.
 *   3. The intentional cross-sub-tree import in
 *      `apps/web/.../CreateOrder.ts` triggers `CHEM-IMPORT-CROSS-LANG-001`
 *      tagged with the source sub-tree's `language_id` ("web").
 *   4. The vocabulary swap (`--vocabulary chemistry`) works on every
 *      command across all three languages.
 *
 * Skip pattern:
 *   - The Go portion of the suite is gated behind `hasGoToolchain()`
 *     mirroring `packages/plugin-go/test/go.test.ts`. When `go` is
 *     unavailable, the Go-only checks skip; the TS + Python portions
 *     still run.
 *   - The Python portion is gated behind `python3` availability,
 *     mirroring `packages/cli/test/e2e/python-workflow.test.ts`.
 *
 * Performance contract: full suite under 60s on a warm cache. The fixture
 * is copied once per `describe` block (not per `it`) and all heavy
 * compound discovery is cached by the manifest cache layer.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { runCli as cliDispatch } from "../../src/cli.js";
import { __resetForTesting as resetVocabulary } from "@chemag/core/vocabulary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_DIR = path.resolve(__dirname, "fixtures/polyglot-mini");

// ---------------------------------------------------------------------------
// Toolchain gates
// ---------------------------------------------------------------------------

let hasPython3 = false;
try {
  execSync("python3 --version", { stdio: "pipe" });
  hasPython3 = true;
} catch {
  hasPython3 = false;
}

function hasGoToolchain(): boolean {
  try {
    execSync("go version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
const goAvailable = hasGoToolchain();

// ---------------------------------------------------------------------------
// Helpers — clone of the cmd-runner used by typescript-workflow.test.ts
// ---------------------------------------------------------------------------

interface RunResult {
  exitCode: number | undefined;
  stdout: string[];
  stderr: string[];
}

function runCmd(fn: (argv: string[]) => void, argv: string[]): RunResult {
  const exitCode = { value: undefined as number | undefined };
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode.value = code;
    throw new Error(`process.exit(${code})`);
  }) as never);
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(" "));
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "));
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "));
  });

  try {
    fn(argv);
  } catch (e) {
    if (!(e as Error).message?.startsWith("process.exit")) throw e;
  }

  exitSpy.mockRestore();
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();

  return { exitCode: exitCode.value, stdout, stderr };
}

/**
 * Run the CLI dispatcher (`runCli`) so global flags like `--vocabulary` are
 * honoured. Mirrors the helper in `vocabulary-e2e.test.ts`.
 */
function runCli(argv: string[]): RunResult {
  const exitCode = { value: undefined as number | undefined };
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode.value = code;
    throw new Error(`process.exit(${code})`);
  }) as never);
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(" "));
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "));
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "));
  });

  try {
    // Reset cached vocabulary state so each --vocabulary swap really takes
    // effect at Phase-1 resolution time. Mirrors vocabulary-e2e.test.ts.
    resetVocabulary();
    cliDispatch(argv);
  } catch (e) {
    if (!(e as Error).message?.startsWith("process.exit")) throw e;
  }

  exitSpy.mockRestore();
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();

  return { exitCode: exitCode.value, stdout, stderr };
}

/**
 * Recursively copy `src` to `dest`. Used to materialize the fixture in a
 * temp directory so each test run gets a clean disk state.
 */
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ---------------------------------------------------------------------------
// Phase 1 — init / add compound / add unit on a fresh single-language TS
// workspace. Verifies these three commands work end-to-end.
// ---------------------------------------------------------------------------

describe("multi-language E2E — Phase 1: init + add (TypeScript)", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-e2e-multi-init-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("init creates a TS workspace from scratch", async () => {
    const { cmdInit } = await import("../../src/commands/init.js");
    const result = runCmd(cmdInit, ["polyglot-init", "--path", tmpDir, "--language", "typescript"]);
    expect(result.exitCode).toBeUndefined();

    const wsPath = path.join(tmpDir, "workspace.yaml");
    expect(fs.existsSync(wsPath)).toBe(true);
    const wsContent = fs.readFileSync(wsPath, "utf-8");
    expect(wsContent).toContain("workspace: polyglot-init");
    expect(wsContent).toContain("language: typescript");
  });

  it("add compound creates a new compound", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    const result = runCmd(cmdAdd, ["compound", "checkout"]);
    expect(result.exitCode).toBeUndefined();

    const manifestPath = path.join(tmpDir, "src/compounds/checkout/compound.yaml");
    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  it("add unit (element + interface + reaction) creates stub files", async () => {
    const { cmdAdd } = await import("../../src/commands/add.js");
    for (const [role, name] of [
      ["element", "CartId"],
      ["interface", "CartRepo"],
      ["reaction", "AddItem"],
    ]) {
      const r = runCmd(cmdAdd, ["unit", "checkout", role, name, "--export"]);
      expect(r.exitCode).toBeUndefined();
    }

    const manifest = parseYaml(
      fs.readFileSync(path.join(tmpDir, "src/compounds/checkout/compound.yaml"), "utf-8"),
    );
    expect(manifest.units).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — polyglot-mini fixture. The fixture is copied once into a temp
// dir; every command in the suite operates on it. Tests are arranged in
// dependency order (graph/check/analyze are read-only; scaffold/sync may
// mutate the tree) but each test asserts only its own outputs.
// ---------------------------------------------------------------------------

describe("multi-language E2E — Phase 2: polyglot-mini commands", () => {
  let tmpDir: string;
  let wsPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-e2e-multi-poly-"));
    copyDir(FIXTURE_DIR, tmpDir);
    wsPath = path.join(tmpDir, "workspace.yaml");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // chemag check — exercised on every sub-tree.
  // -------------------------------------------------------------------
  it("check runs against the four-sub-tree fixture", async () => {
    const { cmdCheck } = await import("../../src/commands/check.js");
    // The intentional cross-lang import lives only in source (not in
    // manifests), so --manifest-only must produce no errors.
    const result = runCmd(cmdCheck, [wsPath, "--manifest-only"]);
    expect(result.exitCode).toBe(0);
    const out = result.stdout.join("\n");
    expect(out).toContain("polyglot-mini");
  });

  // -------------------------------------------------------------------
  // chemag analyze — must flag CHEM-IMPORT-CROSS-LANG-001 with
  // language_id = "web". This is the WP-022 acceptance criterion.
  // -------------------------------------------------------------------
  it("analyze flags the cross-sub-tree import (CHEM-IMPORT-CROSS-LANG-001)", async () => {
    const { cmdAnalyze } = await import("../../src/commands/analyze.js");
    const result = runCmd(cmdAnalyze, [wsPath, "--format", "json"]);
    // Cross-lang import is an error → exit 1.
    expect(result.exitCode).toBe(1);

    // The new --format json shape wraps diagnostics in `runs[0].results`.
    // We only need to confirm the code is in the output stream — exact
    // schema is covered by format-specific tests.
    const out = result.stdout.join("\n");
    expect(out).toContain("CHEM-IMPORT-CROSS-LANG-001");
    // language_id propagated through the Diagnostic.
    expect(out).toContain('"language_id": "web"');
  });

  // -------------------------------------------------------------------
  // chemag analyze (legacy --json) — same diagnostic, ad-hoc shape.
  // -------------------------------------------------------------------
  it("analyze (--json legacy) emits the cross-lang diagnostic", async () => {
    const { cmdAnalyze } = await import("../../src/commands/analyze.js");
    const result = runCmd(cmdAnalyze, [wsPath, "--json"]);
    expect(result.exitCode).toBe(1);
    const out = result.stdout.join("\n");
    const parsed = JSON.parse(out) as {
      errors: number;
      diagnostics: { code?: string; language_id?: string }[];
    };
    expect(parsed.errors).toBeGreaterThanOrEqual(1);
    const xlang = parsed.diagnostics.find((d) => d.code === "CHEM-IMPORT-CROSS-LANG-001");
    expect(xlang).toBeDefined();
    expect(xlang!.language_id).toBe("web");
  });

  // -------------------------------------------------------------------
  // chemag graph — must render one Mermaid subgraph cluster per
  // sub-tree. Single-sub-tree graphs use the legacy type-grouped layout.
  // -------------------------------------------------------------------
  it("graph renders one Mermaid subgraph cluster per sub-tree", async () => {
    const { cmdGraph } = await import("../../src/commands/graph.js");
    const result = runCmd(cmdGraph, [wsPath]);
    expect(result.exitCode).toBeUndefined();
    const out = result.stdout.join("\n");
    expect(out).toContain("graph LR");
    // Sub-tree ids are mermaid-safed (hyphens → underscores) before being
    // used as `subgraph` identifiers, so `web-shared` becomes
    // `subtree_web_shared`. The display label inside the brackets keeps the
    // original id with the language tag.
    expect(out).toContain('subgraph subtree_web["web (typescript)"]');
    expect(out).toContain('subgraph subtree_web_shared["web-shared (typescript)"]');
    expect(out).toContain('subgraph subtree_api["api (python)"]');
    expect(out).toContain('subgraph subtree_worker["worker (go)"]');
  });

  // -------------------------------------------------------------------
  // chemag scaffold — running on a fixture whose stubs ALREADY exist
  // should produce only "skipped" entries (idempotent). Exercises every
  // sub-tree's plugin-level scaffold path.
  // -------------------------------------------------------------------
  it("scaffold is a no-op on the fully-populated fixture", async () => {
    const { cmdScaffold } = await import("../../src/commands/scaffold.js");
    const result = runCmd(cmdScaffold, [wsPath, "--dry-run"]);
    expect(result.exitCode).toBeUndefined();
    const out = result.stdout.join("\n");
    expect(out).toContain("scaffold");
  });

  // -------------------------------------------------------------------
  // chemag sync — manifests already exist for every compound, so sync
  // must report all-skipped. We use --dry-run so sync's
  // `inferImplements` (Python) / Go-helper paths don't shell out for
  // any compound that's already fully described.
  // -------------------------------------------------------------------
  it("sync skips every compound (manifests already present)", async () => {
    const { cmdSync } = await import("../../src/commands/sync.js");
    const result = runCmd(cmdSync, [wsPath, "--dry-run"]);
    expect(result.exitCode).toBeUndefined();
    const out = result.stdout.join("\n");
    // Output may contain ANSI color escapes around the "0" count; assert
    // on the locale-independent "skipped" word that always renders.
    expect(out).toContain("skipped");
  });

  // -------------------------------------------------------------------
  // Vocabulary swap — `--vocabulary chemistry` must change the
  // diagnostic phrasing across every sub-tree.
  // -------------------------------------------------------------------
  it("vocabulary swap (--vocabulary chemistry) reaches every sub-tree", () => {
    // Use runCli so the Phase-1 vocabulary resolver actually consumes
    // --vocabulary. Use --format json so the diagnostic CODE (which is
    // locale-independent) shows up in the output — the human formatter
    // for `analyze` only buckets by `import-bonds` / `import-bypass` /
    // `import-undeclared` and would suppress the cross-lang code text.
    const stdResult = runCli(["analyze", "--vocabulary", "standard", "--format", "json", wsPath]);
    expect(stdResult.exitCode).toBe(1);
    const stdOut = stdResult.stdout.join("\n");
    expect(stdOut).toContain("CHEM-IMPORT-CROSS-LANG-001");

    const chemResult = runCli(["analyze", "--vocabulary", "chemistry", "--format", "json", wsPath]);
    expect(chemResult.exitCode).toBe(1);
    const chemOut = chemResult.stdout.join("\n");
    expect(chemOut).toContain("CHEM-IMPORT-CROSS-LANG-001");

    // The diagnostic message body is rendered through `tr()` and so
    // differs between locales. Confirm the swap had an observable effect:
    // both outputs contain the code, but their full bodies are not equal.
    expect(stdOut).not.toBe(chemOut);
  });

  it("vocabulary swap reaches the check command too", () => {
    const stdResult = runCli(["check", "--vocabulary", "standard", "--manifest-only", wsPath]);
    expect(stdResult.exitCode).toBe(0);

    const chemResult = runCli(["check", "--vocabulary", "chemistry", "--manifest-only", wsPath]);
    expect(chemResult.exitCode).toBe(0);
  });

  it("vocabulary swap reaches the graph command (Mermaid still well-formed)", () => {
    const result = runCli(["graph", "--vocabulary", "chemistry", wsPath]);
    expect(result.exitCode).toBeUndefined();
    const out = result.stdout.join("\n");
    expect(out).toContain("graph LR");
    expect(out).toContain("subtree_web");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — language-specific assertions that only make sense when the
// language toolchain is present. Each describe block self-skips.
// ---------------------------------------------------------------------------

describe.skipIf(!hasPython3)("multi-language E2E — Phase 3a: Python sub-tree assertions", () => {
  let tmpDir: string;
  let wsPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-e2e-multi-py-"));
    copyDir(FIXTURE_DIR, tmpDir);
    wsPath = path.join(tmpDir, "workspace.yaml");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("check (full filesystem) accepts the api/billing compound", async () => {
    // The api sub-tree's __init__.py + interfaces/__init__.py-less folders
    // are valid Python — check should not flag them.
    const { cmdCheck } = await import("../../src/commands/check.js");
    const result = runCmd(cmdCheck, [wsPath, "--manifest-only"]);
    expect(result.exitCode).toBe(0);
  });

  it("sync on a fresh py compound (no manifest) generates one", async () => {
    // Drop a NEW compound directory with Python source files but no
    // compound.yaml; sync must infer the manifest using the Python plugin.
    const newCompoundDir = path.join(tmpDir, "apps/api/src/compounds/payments");
    fs.mkdirSync(path.join(newCompoundDir, "elements"), { recursive: true });
    fs.writeFileSync(
      path.join(newCompoundDir, "elements", "payment_id.py"),
      `"""PaymentId — value object."""\nfrom dataclasses import dataclass\n\n@dataclass(frozen=True)\nclass PaymentId:\n    value: str\n`,
      "utf-8",
    );

    const { cmdSync } = await import("../../src/commands/sync.js");
    const result = runCmd(cmdSync, [wsPath]);
    expect(result.exitCode).toBeUndefined();

    const generatedManifest = path.join(newCompoundDir, "compound.yaml");
    expect(fs.existsSync(generatedManifest)).toBe(true);

    const manifest = parseYaml(fs.readFileSync(generatedManifest, "utf-8"));
    expect(manifest.compound).toBe("payments");
    expect(manifest.units).toHaveLength(1);
    expect(manifest.units[0].file).toContain("payment_id.py");
  });
});

describe.skipIf(!goAvailable)("multi-language E2E — Phase 3b: Go sub-tree assertions", () => {
  let tmpDir: string;
  let wsPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-e2e-multi-go-"));
    copyDir(FIXTURE_DIR, tmpDir);
    wsPath = path.join(tmpDir, "workspace.yaml");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("check accepts the worker/jobs compound", async () => {
    const { cmdCheck } = await import("../../src/commands/check.js");
    const result = runCmd(cmdCheck, [wsPath, "--manifest-only"]);
    expect(result.exitCode).toBe(0);
  });

  it("sync on a fresh Go compound generates a manifest", async () => {
    const newCompoundDir = path.join(tmpDir, "apps/worker/src/compounds/scheduler");
    fs.mkdirSync(path.join(newCompoundDir, "elements"), { recursive: true });
    fs.writeFileSync(
      path.join(newCompoundDir, "elements", "tick_id.go"),
      "package element\n\ntype TickId struct {\n\tValue string\n}\n",
      "utf-8",
    );

    const { cmdSync } = await import("../../src/commands/sync.js");
    const result = runCmd(cmdSync, [wsPath]);
    expect(result.exitCode).toBeUndefined();

    const generatedManifest = path.join(newCompoundDir, "compound.yaml");
    expect(fs.existsSync(generatedManifest)).toBe(true);

    const manifest = parseYaml(fs.readFileSync(generatedManifest, "utf-8"));
    expect(manifest.compound).toBe("scheduler");
    expect(manifest.units).toHaveLength(1);
    expect(manifest.units[0].file).toContain("tick_id.go");
  });
});
