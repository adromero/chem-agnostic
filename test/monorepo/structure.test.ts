/**
 * test/monorepo/structure.test.ts
 *
 * Asserts the monorepo layout matches docs/master-plan/01-repository-structure.md.
 * Runs as part of the root test suite (see vitest.root.config.ts).
 *
 * The intent is to fail fast if a future refactor accidentally:
 * - moves a package out of `packages/`
 * - reintroduces the retired `parse_imports.py`
 * - drops a tooling file (turbo.json, biome.json, ...)
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

function abs(rel: string): string {
  return resolve(repoRoot, rel);
}

describe("monorepo structure", () => {
  describe("workspace tooling", () => {
    it.each([
      ["pnpm-workspace.yaml"],
      ["turbo.json"],
      ["tsconfig.base.json"],
      ["biome.json"],
      [".changeset/config.json"],
      [".changeset/README.md"],
      [".github/workflows/ci.yml"],
      [".github/workflows/release.yml"],
      [".nvmrc"],
      [".npmrc"],
      ["docs/adrs/0001-monorepo-toolchain.md"],
      ["docs/master-plan/STATUS.md"],
      ["docs/master-plan/PREREQUISITES.md"],
      ["scripts/check-prereqs.ts"],
      ["scripts/check-prereqs.test.ts"],
      ["vitest.shared.ts"],
      ["vitest.root.config.ts"],
    ])("%s exists", (relPath) => {
      expect(existsSync(abs(relPath))).toBe(true);
    });
  });

  describe("packages/", () => {
    const pkgs = ["cli", "core", "mcp-server", "plugin-typescript", "plugin-python", "telemetry"];
    it.each(pkgs.map((p) => [p]))("package %s has package.json + tsconfig.json + src/", (pkg) => {
      expect(existsSync(abs(`packages/${pkg}/package.json`))).toBe(true);
      expect(existsSync(abs(`packages/${pkg}/tsconfig.json`))).toBe(true);
      expect(existsSync(abs(`packages/${pkg}/src`))).toBe(true);
    });

    it("CLI package owns the bin shim and exposes both names", () => {
      expect(existsSync(abs("packages/cli/bin/chem-ag"))).toBe(true);
      const pkg = JSON.parse(readFileSync(abs("packages/cli/package.json"), "utf-8"));
      expect(pkg.name).toBe("@chemag/cli");
      expect(pkg.bin).toBeDefined();
      expect(pkg.bin.chemag).toBeDefined();
      expect(pkg.bin["chem-ag"]).toBeDefined();
      expect(pkg.bin.chemag).toBe(pkg.bin["chem-ag"]);
    });

    it("core package exposes typed subpath exports", () => {
      const pkg = JSON.parse(readFileSync(abs("packages/core/package.json"), "utf-8"));
      expect(pkg.name).toBe("@chemag/core");
      expect(pkg.exports).toMatchObject({
        ".": expect.any(Object),
        "./types": expect.any(Object),
        "./loader": expect.any(Object),
        "./checks": expect.any(Object),
        "./scaffold": expect.any(Object),
        "./graph": expect.any(Object),
        "./sync": expect.any(Object),
        "./cache": expect.any(Object),
      });
    });
  });

  describe("retired artifacts", () => {
    it("plugins/python/parse_imports.py is gone", () => {
      expect(existsSync(abs("plugins/python/parse_imports.py"))).toBe(false);
    });

    it("packages/plugin-python/python/parse_imports.py was never introduced", () => {
      expect(existsSync(abs("packages/plugin-python/python/parse_imports.py"))).toBe(false);
    });

    it("plugin-python package.json does not list parse_imports.py", () => {
      const raw = readFileSync(abs("packages/plugin-python/package.json"), "utf-8");
      expect(raw).not.toContain("parse_imports.py");
    });

    it("root package.json does not list parse_imports.py", () => {
      const raw = readFileSync(abs("package.json"), "utf-8");
      expect(raw).not.toContain("parse_imports.py");
    });

    it("legacy single-package src/, plugins/, top-level test/ tree no longer exist as code roots", () => {
      // The old single-package layout had src/cli.ts and plugins/{ts,python}/ at the root.
      expect(existsSync(abs("src/cli.ts"))).toBe(false);
      expect(existsSync(abs("plugins/typescript/index.ts"))).toBe(false);
      expect(existsSync(abs("plugins/python/index.ts"))).toBe(false);
    });
  });

  describe("workspace declarations", () => {
    it("pnpm-workspace.yaml declares packages/*", () => {
      const yaml = readFileSync(abs("pnpm-workspace.yaml"), "utf-8");
      expect(yaml).toMatch(/packages\/\*/);
    });

    it("root package.json is private and not 'chem-ag' anymore", () => {
      const pkg = JSON.parse(readFileSync(abs("package.json"), "utf-8"));
      expect(pkg.private).toBe(true);
      expect(pkg.name).not.toBe("chem-ag");
    });
  });
});
