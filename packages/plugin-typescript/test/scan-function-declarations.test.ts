// ---------------------------------------------------------------------------
// scanFunctionDeclarations — plugin-level unit tests.
//
// Verifies the AST-level facts surfaced for CHEM-DRY-001:
//   * locates every top-level `function` declaration in the file
//   * skips nested function declarations (inside a function body, class,
//     namespace, or other container)
//   * skips arrow functions, methods, and class members
//   * populates `line` from `getStartLineNumber()` when available
// ---------------------------------------------------------------------------
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { typescriptPlugin } from "../src/index.js";
import { scanFunctionDeclarationsBatch } from "../src/parser.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-dry-001-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(rel: string, content: string): string {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
  return abs;
}

describe("scanFunctionDeclarationsBatch", () => {
  it("returns an empty map for empty input", () => {
    const out = scanFunctionDeclarationsBatch([]);
    expect(out.size).toBe(0);
  });

  it("returns an empty array for a file with no function declarations", () => {
    const fp = write("a/file.ts", "export const x = 1;\n");
    const out = scanFunctionDeclarationsBatch([fp]);
    expect(out.get(fp)).toEqual([]);
  });

  it("locates top-level function declarations and captures their names + line numbers", () => {
    const fp = write(
      "a/handlers.ts",
      "export function alpha(): void {}\n" +
        "function beta(): void {}\n" +
        "export function gamma(): number {\n  return 0;\n}\n",
    );
    const out = scanFunctionDeclarationsBatch([fp]);
    const sites = out.get(fp);
    expect(sites).toBeDefined();
    expect(sites!.map((s) => s.functionName)).toEqual(["alpha", "beta", "gamma"]);
    for (const s of sites!) {
      expect(s.absPath).toBe(fp);
      expect(typeof s.line).toBe("number");
      expect(s.line).toBeGreaterThan(0);
    }
  });

  it("skips arrow functions and method declarations", () => {
    const fp = write(
      "a/handlers.ts",
      "export const arrow = (): void => {};\n" +
        "export const obj = {\n  method(): void {},\n};\n" +
        "export class Klass {\n  method(): void {}\n}\n",
    );
    const out = scanFunctionDeclarationsBatch([fp]);
    expect(out.get(fp)).toEqual([]);
  });

  it("skips nested function declarations inside a function body", () => {
    const fp = write(
      "a/handlers.ts",
      "export function outer(): void {\n" +
        "  function inner(): void {}\n" +
        "  inner();\n" +
        "}\n",
    );
    const out = scanFunctionDeclarationsBatch([fp]);
    const sites = out.get(fp);
    expect(sites!.map((s) => s.functionName)).toEqual(["outer"]);
  });

  it("returns sites across multiple files in a single batch call", () => {
    const fa = write(
      "a/x.ts",
      "export function shared(): void {}\nexport function only_a(): void {}\n",
    );
    const fb = write("b/y.ts", "export function shared(): void {}\n");
    const out = scanFunctionDeclarationsBatch([fa, fb]);
    expect(out.get(fa)!.map((s) => s.functionName).sort()).toEqual(["only_a", "shared"]);
    expect(out.get(fb)!.map((s) => s.functionName)).toEqual(["shared"]);
  });

  it("plugin object exposes scanFunctionDeclarations bound to the parser helper", () => {
    const fp = write("a/handlers.ts", "export function f(): void {}\n");
    expect(typescriptPlugin.scanFunctionDeclarations).toBeDefined();
    const out = typescriptPlugin.scanFunctionDeclarations!([fp]);
    expect(out.get(fp)!.map((s) => s.functionName)).toEqual(["f"]);
  });
});
