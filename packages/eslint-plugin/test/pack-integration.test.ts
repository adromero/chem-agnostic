// ---------------------------------------------------------------------------
// `pnpm pack` integration test — gated behind RUN_PACK_TEST=1.
//
// This test catches packaging mistakes (missing `files`, broken exports,
// runtime dep on `@chemag/*`, etc.) that the in-workspace tests can't.
//
// Flow:
//   1. Run `pnpm build` + `pnpm pack` in the plugin package.
//   2. Verify the tarball excludes src/ and test/ and is < 50 KB.
//   3. Verify no `@chemag/*` imports in dist/.
//   4. Initialise a scratch TypeScript project in /tmp.
//   5. `npm install` the tarball + peer deps.
//   6. Generate three deliberately-bad source files + an
//      `eslint.config.js` enabling all three rules.
//   7. `npx eslint .` — assert each rule fires the expected count.
//
// Slow + network-bound — runs only when RUN_PACK_TEST=1.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(here, "..");

const RUN = process.env.RUN_PACK_TEST === "1";

// describe.skipIf shorthand for vitest — older versions just use describe.skip
// when condition is true. Use a manual gate for portability.
describe.skipIf(!RUN)("pack-integration (RUN_PACK_TEST=1) — tarball smoke", () => {
  // Keep a reference to the tempdir so the failure path can log it.
  let tmp: string | null = null;
  let tarballPath: string | null = null;

  it("builds, packs, installs, and lints a scratch project", () => {
    try {
      // ----------------------------------------------------------------
      // 1. Build + pack.
      // ----------------------------------------------------------------
      execSync("pnpm build", { cwd: PLUGIN_ROOT, stdio: "inherit" });
      const packOutput = execSync("pnpm pack --pack-destination .", {
        cwd: PLUGIN_ROOT,
        encoding: "utf8",
      });
      // pnpm pack prints the tarball filename on the last line.
      const lines = packOutput.trim().split(/\r?\n/);
      const fileLine = lines[lines.length - 1].trim();
      tarballPath = path.isAbsolute(fileLine) ? fileLine : path.join(PLUGIN_ROOT, fileLine);
      expect(fs.existsSync(tarballPath!)).toBe(true);

      // ----------------------------------------------------------------
      // 2. Tarball size sanity (< 50 KB).
      // ----------------------------------------------------------------
      const size = fs.statSync(tarballPath!).size;
      expect(size).toBeLessThan(50 * 1024);

      // List tarball contents and verify it excludes src/ + test/.
      const tarList = execSync(`tar -tzf ${JSON.stringify(tarballPath)}`, {
        encoding: "utf8",
      }).trim();
      expect(tarList).not.toMatch(/\/src\//);
      expect(tarList).not.toMatch(/\/test\//);
      // Must include dist/.
      expect(tarList).toMatch(/\/dist\//);

      // ----------------------------------------------------------------
      // 3. No RUNTIME references to @chemag/*. Greps only the .js files in
      // dist/ for `require("@chemag/...")` or `from "@chemag/..."` patterns;
      // comments in .d.ts files that mention `@chemag/*` are fine.
      // ----------------------------------------------------------------
      let chemagHits = "";
      try {
        chemagHits = execSync(
          `tar -xzOf ${JSON.stringify(tarballPath)} --wildcards 'package/dist/**/*.js' | grep -E '(require|from)[^"\\\\\\\']*["\\\\\\\']@chemag/' || true`,
          { encoding: "utf8" },
        ).trim();
      } catch {
        chemagHits = "";
      }
      expect(
        chemagHits,
        `Tarball dist/*.js must not import @chemag/* — found:\n${chemagHits}`,
      ).toBe("");

      // ----------------------------------------------------------------
      // 4. Scratch project init.
      // ----------------------------------------------------------------
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "epd-pack-"));

      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify(
          {
            name: "epd-scratch",
            version: "0.0.0",
            private: true,
            type: "module",
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(
        path.join(tmp, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2020",
              module: "ESNext",
              moduleResolution: "Bundler",
              strict: false,
              esModuleInterop: true,
              skipLibCheck: true,
              noEmit: true,
            },
            include: ["src/**/*"],
          },
          null,
          2,
        ),
      );

      // ----------------------------------------------------------------
      // 5. Install tarball + peer deps.
      // ----------------------------------------------------------------
      execSync(
        `npm install --silent --no-audit --no-fund ${JSON.stringify(
          tarballPath!,
        )} eslint@^9 typescript@^5 @typescript-eslint/parser@^8`,
        { cwd: tmp, stdio: "inherit" },
      );

      // ----------------------------------------------------------------
      // 6. Generate deliberately-bad source + eslint.config.js.
      // ----------------------------------------------------------------
      const compoundsRoot = path.join(tmp, "src/compounds");

      // PORT-001 violation: compound vendors has adapter+reaction, no interface.
      writeFile(
        path.join(compoundsRoot, "vendors/adapters/store.ts"),
        "export const STORE_TAG = 'store';\n",
      );
      writeFile(
        path.join(compoundsRoot, "vendors/reactions/handlers.ts"),
        "export function handle(): void {}\n",
      );

      // PORT-003 violation: orders/reactions imports a concrete class from billing/public.
      writeFile(
        path.join(compoundsRoot, "billing/adapters/Invoice.ts"),
        "export class Invoice {\n  toJSON(): unknown { return {}; }\n}\n",
      );
      writeFile(
        path.join(compoundsRoot, "billing/public.ts"),
        "export { Invoice } from './adapters/Invoice';\n",
      );
      writeFile(
        path.join(compoundsRoot, "orders/reactions/useInvoice.ts"),
        `import { Invoice } from '../../billing/public';\nexport function u(): Invoice { return new Invoice(); }\n`,
      );

      // PORT-004 violation: shipping/reactions does `new ShippingClient()` on
      // a same-compound adapter (no catalystCompounds set — should fire).
      writeFile(
        path.join(compoundsRoot, "shipping/adapters/ShippingClient.ts"),
        "export class ShippingClient {\n  send(): void {}\n}\n",
      );
      writeFile(
        path.join(compoundsRoot, "shipping/reactions/ship.ts"),
        `import { ShippingClient } from '../adapters/ShippingClient';\nexport function ship(): void { const c = new ShippingClient(); void c; }\n`,
      );

      // Flat-config: enable all three rules. Use parserOptions.projectService
      // so we don't have to manage a tsconfig "include" path explicitly.
      const eslintConfig = `
import portDiscipline from 'eslint-plugin-port-discipline';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: ${JSON.stringify(tmp)},
      },
    },
    plugins: { 'port-discipline': portDiscipline },
    rules: {
      'port-discipline/needs-interface': ['error', { compoundsRoot: ${JSON.stringify(compoundsRoot)} }],
      'port-discipline/no-concrete-class-import': ['error', { compoundsRoot: ${JSON.stringify(compoundsRoot)} }],
      'port-discipline/no-adapter-instantiation': ['error', { compoundsRoot: ${JSON.stringify(compoundsRoot)} }],
    },
  },
];
`.trimStart();
      fs.writeFileSync(path.join(tmp, "eslint.config.js"), eslintConfig);

      // ----------------------------------------------------------------
      // 7. Run eslint and parse JSON output.
      // ----------------------------------------------------------------
      let raw = "";
      try {
        raw = execSync("npx --no-install eslint . --format json", {
          cwd: tmp,
          encoding: "utf8",
          // Suppress stderr — eslint emits a non-zero exit code when rules fire.
        });
      } catch (err) {
        // eslint exits non-zero on lint errors; we still want stdout.
        const e = err as { stdout?: Buffer | string };
        raw = (typeof e.stdout === "string" ? e.stdout : e.stdout?.toString("utf8")) ?? "";
      }
      const results = JSON.parse(raw) as {
        filePath: string;
        messages: { ruleId: string | null }[];
      }[];

      const counts: Record<string, number> = {};
      for (const file of results) {
        for (const m of file.messages) {
          if (m.ruleId) counts[m.ruleId] = (counts[m.ruleId] ?? 0) + 1;
        }
      }

      // PORT-001 fires once per compound (dedupe by first-adapter rule).
      // Two compounds match: `vendors` (adapter+reaction, no interface) and
      // `shipping` (adapter+reaction, no interface).
      expect(counts["port-discipline/needs-interface"], JSON.stringify(counts)).toBe(2);
      // PORT-003 fires once on the orders→billing concrete-class import.
      expect(counts["port-discipline/no-concrete-class-import"], JSON.stringify(counts)).toBe(1);
      // PORT-004 fires on (a) orders/reactions/useInvoice.ts → new Invoice()
      // (cross-compound, non-catalyst caller) and (b) shipping/reactions/ship.ts
      // → new ShippingClient() (intra-compound, non-catalyst caller).
      expect(counts["port-discipline/no-adapter-instantiation"], JSON.stringify(counts)).toBe(2);
    } finally {
      if (tmp !== null) {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`Pack-integration cleanup failed; debris left at: ${tmp}`, err);
        }
      }
      if (tarballPath !== null && fs.existsSync(tarballPath)) {
        try {
          fs.unlinkSync(tarballPath);
        } catch {
          /* leave for human inspection */
        }
      }
    }
  }, /* timeout */ 120_000);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
