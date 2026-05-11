// ---------------------------------------------------------------------------
// CHEM-DRY-001 — fixture-driven integration tests.
//
// Drives `runFixture(...)` with a mock `LanguagePlugin` that synthesizes
// `scanFunctionDeclarations` from the on-disk fixture's unit-file list. This
// keeps `@chemag/core` test code free of any dependency on
// `@chemag/plugin-typescript` while still exercising the
// scanFunctionDeclarations → checkDuplicatedFunction wiring end-to-end.
//
// The plugin-level AST walk is covered separately by the plugin-typescript
// test (`scan-function-declarations.test.ts`).
// ---------------------------------------------------------------------------
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runFixture, NOOP_PLUGIN } from "../helpers/run-fixture.js";
import type { LanguagePlugin } from "../../src/plugin-interface.js";
import type { FunctionDeclarationSite } from "../../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../fixtures/semantic-rules/dry-001");

const dry001 = (diags: { code: string }[]) => diags.filter((d) => d.code === "CHEM-DRY-001");

/**
 * Build a mock plugin that returns pre-computed `FunctionDeclarationSite[]`
 * from `scanFunctionDeclarations`. Mirrors the PORT-004 fixture harness.
 *
 * `parseImportsBatch` returns an empty map — none of the dry-001 fixtures
 * depend on per-edge bond / cross-compound diagnostics.
 */
function mockPluginWithSites(
  sitesByFile: Record<string, FunctionDeclarationSite[]>,
): LanguagePlugin {
  return {
    ...NOOP_PLUGIN,
    name: "dry-001-mock",
    defaults: {
      publicSurface: "public.ts",
      testFilePattern: /\.test\.ts$/,
      testFrameworkImport: "vitest",
    },
    scanFunctionDeclarations(filePaths: string[]): Map<string, FunctionDeclarationSite[]> {
      const out = new Map<string, FunctionDeclarationSite[]>();
      for (const fp of filePaths) {
        const hit = sitesByFile[fp];
        if (hit) out.set(fp, hit);
      }
      return out;
    },
  };
}

function abs(fixtureDir: string, ...rel: string[]): string {
  return path.resolve(fixtureDir, ...rel);
}

describe("CHEM-DRY-001 — fixture integration tests", () => {
  it("invalid/duplicated: fieldErrorsFromZod declared in 4 handler files → DRY-001 fires once", async () => {
    const fixtureDir = path.join(FIXTURES, "invalid/duplicated");
    const files = [
      abs(fixtureDir, "src/compounds/users/reactions/handlers.ts"),
      abs(fixtureDir, "src/compounds/orders/reactions/handlers.ts"),
      abs(fixtureDir, "src/compounds/payments/reactions/handlers.ts"),
      abs(fixtureDir, "src/compounds/inventory/reactions/handlers.ts"),
    ];
    const sitesByFile: Record<string, FunctionDeclarationSite[]> = {};
    for (const f of files) {
      sitesByFile[f] = [
        { functionName: "fieldErrorsFromZod", absPath: f },
        { functionName: "handleRequest", absPath: f },
      ];
    }
    const plugin = mockPluginWithSites(sitesByFile);

    const { analyzeDiagnostics } = await runFixture(fixtureDir, { plugin });
    const hits = dry001(analyzeDiagnostics);
    // Two names duplicated 4x each: `fieldErrorsFromZod` and `handleRequest`.
    expect(hits).toHaveLength(2);
    for (const h of hits) {
      expect(h.level).toBe("suggestion");
      expect(h.message).toContain("4");
    }
    expect(hits[0].message).toContain("fieldErrorsFromZod");
    expect(hits[1].message).toContain("handleRequest");
  });

  it("valid/unique: every function in one file → no DRY-001", async () => {
    const fixtureDir = path.join(FIXTURES, "valid/unique");
    const file = abs(fixtureDir, "src/compounds/utils/reactions/handlers.ts");
    const plugin = mockPluginWithSites({
      [file]: [
        { functionName: "alpha", absPath: file },
        { functionName: "beta", absPath: file },
        { functionName: "gamma", absPath: file },
        { functionName: "delta", absPath: file },
      ],
    });
    const { analyzeDiagnostics } = await runFixture(fixtureDir, { plugin });
    expect(dry001(analyzeDiagnostics)).toEqual([]);
  });

  it("valid/below-threshold: validate in 2 files (default threshold=3) → no DRY-001", async () => {
    const fixtureDir = path.join(FIXTURES, "valid/below-threshold");
    const files = [
      abs(fixtureDir, "src/compounds/users/reactions/handlers.ts"),
      abs(fixtureDir, "src/compounds/orders/reactions/handlers.ts"),
    ];
    const sitesByFile: Record<string, FunctionDeclarationSite[]> = {};
    for (const f of files) sitesByFile[f] = [{ functionName: "validate", absPath: f }];
    const plugin = mockPluginWithSites(sitesByFile);
    const { analyzeDiagnostics } = await runFixture(fixtureDir, { plugin });
    expect(dry001(analyzeDiagnostics)).toEqual([]);
  });

  it("valid/tests-excluded: checkInputValidity in 5 *.test.ts files → no DRY-001 (test-path exempt)", async () => {
    const fixtureDir = path.join(FIXTURES, "valid/tests-excluded");
    const files = ["a", "b", "c", "d", "e"].map((c) =>
      abs(fixtureDir, `src/compounds/${c}/reactions/handlers.test.ts`),
    );
    const sitesByFile: Record<string, FunctionDeclarationSite[]> = {};
    for (const f of files) {
      sitesByFile[f] = [
        { functionName: "checkInputValidity", absPath: f },
        { functionName: "runTest", absPath: f },
      ];
    }
    const plugin = mockPluginWithSites(sitesByFile);
    const { analyzeDiagnostics } = await runFixture(fixtureDir, { plugin });
    expect(dry001(analyzeDiagnostics)).toEqual([]);
  });

  it("plugin without scanFunctionDeclarations: skip — no DRY-001 emitted", async () => {
    const fixtureDir = path.join(FIXTURES, "invalid/duplicated");
    const plugin: LanguagePlugin = {
      ...NOOP_PLUGIN,
      name: "dry-001-noscan",
      // scanFunctionDeclarations intentionally absent.
    };
    const { analyzeDiagnostics } = await runFixture(fixtureDir, { plugin });
    expect(dry001(analyzeDiagnostics)).toEqual([]);
  });
});
