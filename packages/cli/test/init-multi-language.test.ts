// ---------------------------------------------------------------------------
// wp-019: Multi-language init flow (`chemag init <name> --language ts --language py`).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";
import { cmdInit } from "../src/commands/init.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-init-multi-"));
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
  }) as never);

  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "));
  });
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "));
  });

  try {
    cmdInit(["multiapp", "--path", tmpDir, ...args]);
  } catch (e) {
    if (!(e as Error).message?.startsWith("process.exit")) throw e;
  }

  exitSpy.mockRestore();

  return { exitCode: exitCode.value, stderr, stdout };
}

describe("cmdInit — multi-language workspace", () => {
  it("emits a languages: block when --language is supplied twice", () => {
    runInit(["--language", "typescript", "--language", "python"]);

    const wsPath = path.join(tmpDir, "workspace.yaml");
    expect(fs.existsSync(wsPath)).toBe(true);
    const parsed = parseYaml(fs.readFileSync(wsPath, "utf-8")) as {
      languages: { id: string; language: string; paths: { compounds: string } }[];
      language?: unknown;
      paths?: unknown;
    };

    expect(Array.isArray(parsed.languages)).toBe(true);
    expect(parsed.languages).toHaveLength(2);
    expect(parsed.languages[0].id).toBe("typescript");
    expect(parsed.languages[0].language).toBe("typescript");
    expect(parsed.languages[1].id).toBe("python");
    expect(parsed.languages[1].language).toBe("python");

    // Multi-language YAML deliberately omits the legacy top-level fields
    // — input authority lives on `languages:`. The loader DERIVES them.
    expect(parsed.language).toBeUndefined();
    expect(parsed.paths).toBeUndefined();
  });

  it("scaffolds per-sub-tree directory trees on disk", () => {
    runInit(["--language", "typescript", "--language", "python"]);

    for (const id of ["typescript", "python"]) {
      for (const role of ["compounds", "reagents", "solvents", "catalyst"]) {
        const dir = path.join(tmpDir, "apps", id, "src", role);
        expect(fs.existsSync(dir), `${dir} should exist`).toBe(true);
      }
    }
  });

  it("disambiguates ids when the same language is supplied multiple times", () => {
    runInit(["--language", "typescript", "--language", "typescript"]);

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, "workspace.yaml"), "utf-8")) as {
      languages: { id: string }[];
    };
    expect(parsed.languages.map((l) => l.id)).toEqual(["typescript-1", "typescript-2"]);
  });

  it("preserves --language order in the emitted languages block", () => {
    runInit(["--language", "python", "--language", "typescript"]);

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, "workspace.yaml"), "utf-8")) as {
      languages: { id: string; language: string; public_surface: string }[];
    };

    expect(parsed.languages[0].language).toBe("python");
    expect(parsed.languages[0].public_surface).toBe("__init__.py");
    expect(parsed.languages[1].language).toBe("typescript");
    expect(parsed.languages[1].public_surface).toBe("public.ts");
  });

  it("falls back to the legacy single-language flow when only one --language is supplied", () => {
    runInit(["--language", "typescript"]);

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, "workspace.yaml"), "utf-8")) as {
      language: string;
      paths: { compounds: string };
      languages?: unknown;
    };

    expect(parsed.language).toBe("typescript");
    expect(parsed.paths.compounds).toBe("./src/compounds");
    // Legacy flow does NOT emit a `languages:` block.
    expect(parsed.languages).toBeUndefined();
  });
});
