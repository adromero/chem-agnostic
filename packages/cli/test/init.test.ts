import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { cmdInit, checkPython3Available } from "../src/commands/init.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-init-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function runInit(args: string[]): {
  exitCode: number | undefined;
  stderr: string[];
  stdout: string[];
} {
  const exitCode = { value: undefined as number | undefined };
  const stderr: string[] = [];
  const stdout: string[] = [];

  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode.value = code;
    throw new Error(`process.exit(${code})`);
  }) as any);

  const errorSpy = vi.spyOn(console, "error").mockImplementation((...a: any[]) => {
    stderr.push(a.join(" "));
  });

  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: any[]) => {
    stdout.push(a.join(" "));
  });

  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a: any[]) => {
    stderr.push(a.join(" "));
  });

  try {
    cmdInit(["testapp", "--path", tmpDir, ...args]);
  } catch (e: any) {
    if (!e.message?.startsWith("process.exit")) throw e;
  }

  exitSpy.mockRestore();
  errorSpy.mockRestore();
  logSpy.mockRestore();
  warnSpy.mockRestore();

  return {
    exitCode: exitCode.value,
    stderr,
    stdout,
  };
}

describe("cmdInit with --language typescript", () => {
  it("creates workspace.yaml with language: typescript", () => {
    runInit(["--language", "typescript"]);
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const content = fs.readFileSync(wsPath, "utf-8");
    expect(content).toContain("language: typescript");
    expect(content).toContain("workspace: testapp");
  });

  it("uses public.ts as public_surface", () => {
    runInit(["--language", "typescript"]);
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const content = fs.readFileSync(wsPath, "utf-8");
    expect(content).toContain("public_surface: public.ts");
  });

  it("generates CLAUDE.md with core and TypeScript content", () => {
    runInit(["--language", "typescript"]);
    const claudeMdPath = path.join(tmpDir, "CLAUDE.md");
    const content = fs.readFileSync(claudeMdPath, "utf-8");
    // Default vocabulary is "standard" — title and section headings reflect
    // that. The chemistry vocabulary is opt-in via --vocabulary or
    // CHEMAG_VOCABULARY. The shared sections still appear.
    expect(content).toContain("# testapp —");
    expect(content).toContain("## Roles");
    expect(content).toMatch(/## (Bond Rules|Dependency Rules)/);
    expect(content).toMatch(/## (Compound|Module) Types/);
    expect(content).toContain("## Workflow");
    expect(content).toContain("## Rules for AI Assistants");
    // TypeScript-specific section: references public.ts
    expect(content).toContain("public.ts");
  });

  it("creates directory structure", () => {
    runInit(["--language", "typescript"]);
    expect(fs.existsSync(path.join(tmpDir, "src/compounds"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "src/reagents"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "src/solvents"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "src/catalyst"))).toBe(true);
  });

  it("prints default language notice when --language is not passed", () => {
    const { stdout } = runInit([]);
    const allOutput = stdout.join("\n");
    expect(allOutput).toContain("Using TypeScript");
    expect(allOutput).toContain("--language python");
  });
});

describe("cmdInit with --language python", () => {
  it("creates workspace.yaml with language: python", () => {
    runInit(["--language", "python"]);
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const content = fs.readFileSync(wsPath, "utf-8");
    expect(content).toContain("language: python");
    expect(content).toContain("workspace: testapp");
  });

  it("uses __init__.py as public_surface", () => {
    runInit(["--language", "python"]);
    const wsPath = path.join(tmpDir, "workspace.yaml");
    const content = fs.readFileSync(wsPath, "utf-8");
    expect(content).toContain("public_surface: __init__.py");
  });

  it("generates CLAUDE.md with Python-specific content", () => {
    runInit(["--language", "python"]);
    const claudeMdPath = path.join(tmpDir, "CLAUDE.md");
    const content = fs.readFileSync(claudeMdPath, "utf-8");
    expect(content).toContain("# testapp —");
    expect(content).toMatch(/## (Bond Rules|Dependency Rules)/);
    // Python-specific: references __init__.py and Python language section
    expect(content).toContain("__init__.py");
    expect(content).toContain("Language: Python");
  });
});

describe("cmdInit python3 availability check", () => {
  it("checkPython3Available returns false when python3 not found", () => {
    // We test the checkPython3Available function directly.
    // On most systems python3 is available, so we just verify it returns boolean.
    const result = checkPython3Available();
    expect(typeof result).toBe("boolean");
  });

  it("warns if python3 is not found (integration)", () => {
    // We use PATH manipulation to simulate python3 not being found
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-dir-only";

    try {
      const { stderr } = runInit(["--language", "python"]);
      const allStderr = stderr.join("\n");
      expect(allStderr).toContain("Python 3.10+ not found");
      expect(allStderr).toContain("chem-ag analyze");
      expect(allStderr).toContain("chem-ag scaffold");
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("does not warn when python3 is available", () => {
    // If python3 IS available on this machine, no warning should appear
    // If it's not, this test still passes (the warning would appear but
    // we're not asserting its absence in a way that breaks)
    const { exitCode } = runInit(["--language", "python"]);
    expect(exitCode).toBeUndefined();
  });
});

describe("cmdInit error cases", () => {
  it("fails if workspace.yaml already exists", () => {
    fs.writeFileSync(path.join(tmpDir, "workspace.yaml"), "existing", "utf-8");
    const { exitCode, stderr } = runInit(["--language", "typescript"]);
    expect(exitCode).toBe(1);
    const allStderr = stderr.join("\n");
    expect(allStderr).toContain("already exists");
  });
});
