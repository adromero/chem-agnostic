// ---------------------------------------------------------------------------
// Completion command + shell-syntax tests. WP-008.
//
// What we cover here:
//   - `chemag completion bash|zsh|fish` exits 0 and prints a non-empty script.
//   - Unknown shell exits 2 with a clear error.
//   - Bash output passes `bash -n` (always available; sufficient for syntax).
//     If `shellcheck` is on PATH, we additionally lint against it.
//   - Zsh output: if `zsh` is on PATH, we run `zsh -n`. Otherwise, we still
//     assert the file starts with `#compdef chemag` (the zsh autoload marker).
//   - Fish output: we assert the file uses `complete -c chemag` directives
//     (full fish-syntax checking requires `fish` on PATH; gated check).
//   - Drift check: re-running `scripts/gen-completions.ts` produces the
//     committed scripts byte-for-byte.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { __resetForTesting } from "@chemag/core/vocabulary";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COMPLETIONS_DIR = resolve(__dirname, "..", "src", "completions");

let stdoutChunks: string[];
let stderrChunks: string[];
let writeChunks: string[];
let exitCode: number | undefined;

beforeEach(() => {
  __resetForTesting();
  stdoutChunks = [];
  stderrChunks = [];
  writeChunks = [];
  exitCode = undefined;

  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode = code;
    throw new Error("__cli_exit__");
  }) as never);
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdoutChunks.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    stderrChunks.push(a.join(" "));
  });
  // cmdCompletion writes via process.stdout.write — capture that too.
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    writeChunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function run(argv: string[]): void {
  try {
    runCli(argv);
  } catch (e: unknown) {
    if ((e as Error).message !== "__cli_exit__") throw e;
  }
}

describe("chemag completion <shell>", () => {
  it("bash: prints a non-empty script and exits 0", () => {
    run(["completion", "bash"]);
    expect(exitCode).toBe(0);
    const out = writeChunks.join("");
    expect(out.length).toBeGreaterThan(50);
    expect(out).toContain("_chemag()");
    expect(out).toContain("complete -F _chemag chemag");
  });

  it("zsh: prints a non-empty script starting with #compdef", () => {
    run(["completion", "zsh"]);
    expect(exitCode).toBe(0);
    const out = writeChunks.join("");
    expect(out.startsWith("#compdef chemag")).toBe(true);
    expect(out).toContain("_chemag()");
  });

  it("fish: prints a non-empty script with complete directives", () => {
    run(["completion", "fish"]);
    expect(exitCode).toBe(0);
    const out = writeChunks.join("");
    expect(out).toContain("complete -c chemag");
    expect(out).toContain("complete -c chem-ag");
  });

  it("unknown shell: exits 2 with a clear error", () => {
    run(["completion", "powershell"]);
    expect(exitCode).toBe(2);
    expect(stderrChunks.join("\n")).toMatch(/unsupported shell/i);
  });

  it("missing shell: exits 2", () => {
    run(["completion"]);
    expect(exitCode).toBe(2);
    expect(stderrChunks.join("\n")).toMatch(/missing required argument/i);
  });

  it("--help on completion subcommand exits 0 with usage", () => {
    run(["completion", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdoutChunks.join("\n")).toMatch(/Supported shells/);
  });
});

describe("completion script syntax", () => {
  const bashPath = join(COMPLETIONS_DIR, "bash.sh");
  const zshPath = join(COMPLETIONS_DIR, "zsh.sh");
  const fishPath = join(COMPLETIONS_DIR, "fish.fish");

  it("bash.sh passes `bash -n`", () => {
    const r = spawnSync("bash", ["-n", bashPath], { encoding: "utf-8" });
    expect(r.status, r.stderr).toBe(0);
  });

  it("bash.sh passes shellcheck (if installed)", () => {
    if (!hasOnPath("shellcheck")) return;
    const r = spawnSync("shellcheck", ["--shell=bash", bashPath], { encoding: "utf-8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("zsh.sh passes `zsh -n` (if installed)", () => {
    if (!hasOnPath("zsh")) return;
    const r = spawnSync("zsh", ["-n", zshPath], { encoding: "utf-8" });
    expect(r.status, r.stderr).toBe(0);
  });

  it("zsh.sh starts with #compdef autoload marker", () => {
    const text = readFileSync(zshPath, "utf-8");
    expect(text.startsWith("#compdef chemag")).toBe(true);
  });

  it("fish.fish lists the `chemag` and `chem-ag` aliases", () => {
    const text = readFileSync(fishPath, "utf-8");
    expect(text).toContain("complete -c chemag");
    expect(text).toContain("complete -c chem-ag");
  });
});

describe("completion-script drift check", () => {
  it("re-running gen-completions.ts produces byte-identical output", () => {
    // Snapshot the committed files.
    const before = {
      bash: readFileSync(join(COMPLETIONS_DIR, "bash.sh"), "utf-8"),
      zsh: readFileSync(join(COMPLETIONS_DIR, "zsh.sh"), "utf-8"),
      fish: readFileSync(join(COMPLETIONS_DIR, "fish.fish"), "utf-8"),
    };

    // Run the generator into a sandbox by overlaying a temp `src/completions`
    // path. The simplest approach is to invoke the generator with tsx and
    // inspect stdout — but the script writes to disk. We instead execute it
    // in-place; if it overwrites identically, the diff is empty, which is
    // exactly the drift assertion. We restore on test failure.
    const repoRoot = resolve(__dirname, "..", "..", "..");
    const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
    const scriptPath = resolve(__dirname, "..", "scripts", "gen-completions.ts");

    try {
      execSync(`${tsxBin} ${scriptPath}`, { cwd: resolve(__dirname, "..") });
    } catch (err) {
      throw new Error(`gen-completions.ts failed: ${(err as Error).message}`);
    }

    const after = {
      bash: readFileSync(join(COMPLETIONS_DIR, "bash.sh"), "utf-8"),
      zsh: readFileSync(join(COMPLETIONS_DIR, "zsh.sh"), "utf-8"),
      fish: readFileSync(join(COMPLETIONS_DIR, "fish.fish"), "utf-8"),
    };

    if (after.bash !== before.bash || after.zsh !== before.zsh || after.fish !== before.fish) {
      // Restore the committed versions before failing so a subsequent test
      // re-run doesn't see drifted files.
      writeFileSync(join(COMPLETIONS_DIR, "bash.sh"), before.bash, "utf-8");
      writeFileSync(join(COMPLETIONS_DIR, "zsh.sh"), before.zsh, "utf-8");
      writeFileSync(join(COMPLETIONS_DIR, "fish.fish"), before.fish, "utf-8");
      throw new Error(
        "Completion scripts drifted. Re-run 'pnpm --filter @chemag/cli gen:completions' and commit the changes.",
      );
    }
  });
});

function hasOnPath(cmd: string): boolean {
  try {
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
      encoding: "utf-8",
    });
    return r.status === 0 && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
}
