import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedImport } from "@chemag/core/types";

// ---------------------------------------------------------------------------
// Helper-binary discovery
// ---------------------------------------------------------------------------

/**
 * Resolve the directory that holds prebuilt `chemag-go-helper` binaries.
 *
 * Layout (relative to the package root):
 *   bin/
 *     darwin-amd64/chemag-go-helper
 *     darwin-arm64/chemag-go-helper
 *     linux-amd64/chemag-go-helper
 *     linux-arm64/chemag-go-helper
 *     windows-amd64/chemag-go-helper.exe
 *     windows-arm64/chemag-go-helper.exe
 */
function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/parser.ts (vitest alias) → ../  ;  dist/parser.js → ../
  return resolve(here, "..");
}

/**
 * Map Node's `process.platform` (`linux`, `darwin`, `win32`) and
 * `process.arch` (`x64`, `arm64`, ...) to Go's `GOOS`/`GOARCH` directory
 * naming. Used both at runtime to find the bundled binary AND by
 * `scripts/build-helper.sh` which writes binaries under the same names.
 *
 * Supported matrix: darwin/linux/windows × amd64/arm64.
 */
function platformDirName(): string | undefined {
  const goos =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "linux"
        ? "linux"
        : process.platform === "win32"
          ? "windows"
          : undefined;
  const goarch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : undefined;
  if (!goos || !goarch) return undefined;
  return `${goos}-${goarch}`;
}

function helperBinaryName(): string {
  return process.platform === "win32" ? "chemag-go-helper.exe" : "chemag-go-helper";
}

/**
 * Returns the absolute path to the bundled helper binary for the current
 * platform if it exists on disk, or undefined if no prebuilt binary is
 * shipped for this OS/arch combination (or the file is missing — e.g. in
 * local dev where `scripts/build-helper.sh` hasn't been run).
 *
 * The `CHEMAG_GO_HELPER` env var overrides discovery and points at an
 * arbitrary helper binary (used by tests that build the helper ad-hoc).
 */
export function discoverHelperBinary(): string | undefined {
  if (process.env.CHEMAG_GO_HELPER) {
    const explicit = process.env.CHEMAG_GO_HELPER;
    return existsSync(explicit) ? explicit : undefined;
  }
  const dirName = platformDirName();
  if (!dirName) return undefined;
  const candidate = join(packageRoot(), "bin", dirName, helperBinaryName());
  return existsSync(candidate) ? candidate : undefined;
}

// ---------------------------------------------------------------------------
// JSON-RPC over stdio
// ---------------------------------------------------------------------------

interface RpcRequest {
  method: string;
  params: unknown;
}

interface RpcSuccess<T> {
  ok: true;
  result: T;
}

interface RpcError {
  ok: false;
  error: string;
}

type RpcResponse<T> = RpcSuccess<T> | RpcError;

/**
 * Spawn the helper binary, send a single line-delimited JSON request,
 * read a single line-delimited JSON response.
 *
 * The helper is short-lived: each invocation re-spawns it. This keeps the
 * client trivial and matches how `inferImplements` already works in the
 * Python plugin. Batch calls amortize the spawn cost.
 */
function rpc<T>(method: string, params: unknown): T | undefined {
  const helper = discoverHelperBinary();
  if (!helper) return undefined;

  const request: RpcRequest = { method, params };
  const result = spawnSync(helper, [], {
    input: `${JSON.stringify(request)}\n`,
    encoding: "utf-8",
    timeout: 30_000,
  });

  if (result.error || result.status !== 0 || !result.stdout) {
    return undefined;
  }

  try {
    const firstLine = result.stdout.split(/\r?\n/, 1)[0] ?? "";
    const parsed = JSON.parse(firstLine) as RpcResponse<T>;
    if (!parsed.ok) return undefined;
    return parsed.result;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Public API — implements the LanguagePlugin parser surface
// ---------------------------------------------------------------------------

/**
 * Parse imports from multiple Go files in a single helper invocation.
 * Returns a Map from file path → ParsedImport[]. Files the helper could
 * not parse get an empty array.
 *
 * If no helper binary is bundled for the current platform, returns a Map
 * where every path maps to an empty array — this lets callers degrade
 * gracefully without crashing the whole CLI.
 */
export function parseImportsBatch(filePaths: string[]): Map<string, ParsedImport[]> {
  const result = new Map<string, ParsedImport[]>();
  if (filePaths.length === 0) return result;

  const response = rpc<Record<string, ParsedImport[]>>("parseBatch", { files: filePaths });
  if (!response) {
    for (const fp of filePaths) result.set(fp, []);
    return result;
  }

  for (const fp of filePaths) {
    result.set(fp, response[fp] ?? []);
  }
  return result;
}

/**
 * Parse imports from a single Go file. Convenience wrapper over
 * parseImportsBatch.
 */
export function parseImports(filePath: string): ParsedImport[] {
  const batch = parseImportsBatch([filePath]);
  return batch.get(filePath) ?? [];
}

// ---------------------------------------------------------------------------
// Module resolution
// ---------------------------------------------------------------------------

/**
 * Walk up from `fromFile` to find the nearest go.mod. Returns
 * { moduleRoot, modulePath } where modulePath is the declared `module`
 * directive value, or undefined if none is found.
 */
export function findGoModule(
  fromFile: string,
): { moduleRoot: string; modulePath: string } | undefined {
  let dir = dirname(resolve(fromFile));
  // Stop at filesystem root or after a sane number of hops.
  for (let i = 0; i < 64; i++) {
    const candidate = join(dir, "go.mod");
    if (existsSync(candidate)) {
      try {
        const source = readFileSync(candidate, "utf-8");
        const match = source.match(/^\s*module\s+(\S+)/m);
        if (match?.[1]) {
          return { moduleRoot: dir, modulePath: match[1] };
        }
      } catch {
        return undefined;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/**
 * Resolve a Go import specifier to an absolute file path.
 *
 * Go imports a package, not a file — but for the chem analyzer we want a
 * concrete source file to anchor diagnostics. We pick the first `*.go`
 * file (excluding `_test.go`) in the imported package directory.
 *
 * Module-internal imports (`<modulePath>/<sub>`) resolve via go.mod.
 * External package imports (e.g. `fmt`, `github.com/foo/bar`) return undefined.
 */
export function resolveModulePath(fromFile: string, moduleSpec: string): string | undefined {
  const mod = findGoModule(fromFile);
  if (!mod) return undefined;

  if (moduleSpec !== mod.modulePath && !moduleSpec.startsWith(`${mod.modulePath}/`)) {
    return undefined;
  }

  const relative = moduleSpec === mod.modulePath ? "" : moduleSpec.slice(mod.modulePath.length + 1);
  const pkgDir = relative ? join(mod.moduleRoot, relative) : mod.moduleRoot;
  if (!existsSync(pkgDir)) return undefined;

  let entries: string[];
  try {
    entries = readdirSync(pkgDir);
  } catch {
    return undefined;
  }

  const candidate = entries.filter((e) => e.endsWith(".go") && !e.endsWith("_test.go")).sort()[0];
  return candidate ? join(pkgDir, candidate) : undefined;
}
