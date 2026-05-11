// ---------------------------------------------------------------------------
// CHEM-PORT-004 — fixture-driven integration tests.
//
// Drives `runFixture(...)` with an inline mock `LanguagePlugin` that
// implements `scanNewExpressions` by reading per-fixture, pre-computed
// site arrays. This keeps `@chemag/core` free of any dependency on
// `@chemag/plugin-typescript` while still exercising the
// scanNewExpressions → checkPortAdapterInstantiation wiring end-to-end.
//
// The plugin-level resolution of constructor symbols (alias-walking,
// transient-comment parsing) is covered separately by
// `packages/plugin-typescript/test/scan-new-expressions.test.ts`.
// ---------------------------------------------------------------------------
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runFixture, NOOP_PLUGIN } from "../helpers/run-fixture.js";
import type { LanguagePlugin } from "../../src/plugin-interface.js";
import type { NewExpressionSite } from "../../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../fixtures/semantic-rules/port-004");

const port004 = (diags: { code: string }[]) => diags.filter((d) => d.code === "CHEM-PORT-004");

/**
 * Build a mock plugin that returns pre-computed `NewExpressionSite[]` from
 * `scanNewExpressions`. The `sitesByFile` map MUST use absolute paths
 * (matching what `checkImports` passes in via `allFilePaths`).
 *
 * `parseImportsBatch` returns an empty map — none of the fixtures depend on
 * the per-edge bond / cross-compound diagnostics, only on PORT-004.
 *
 * `resolveModulePath` returns `undefined` because PORT-004 does not need
 * module resolution — the constructor-decl path is supplied directly by
 * the site, and the `fileIndex` is built from unit manifests.
 */
function mockPluginWithSites(sitesByFile: Record<string, NewExpressionSite[]>): LanguagePlugin {
  return {
    ...NOOP_PLUGIN,
    name: "port-004-mock",
    defaults: {
      publicSurface: "public.ts",
      testFilePattern: /\.test\.ts$/,
      testFrameworkImport: "vitest",
    },
    scanNewExpressions(filePaths: string[]): Map<string, NewExpressionSite[]> {
      const out = new Map<string, NewExpressionSite[]>();
      for (const fp of filePaths) {
        const hit = sitesByFile[fp];
        if (hit) out.set(fp, hit);
      }
      return out;
    },
  };
}

/** Helper: absolute paths under a fixture's compound tree. */
function abs(fixtureDir: string, ...rel: string[]): string {
  return path.resolve(fixtureDir, ...rel);
}

describe("CHEM-PORT-004 — fixture integration tests", () => {
  it("invalid/handler-wires: non-catalyst reaction calls new VendorRepo() → PORT-004 fires exactly once", async () => {
    const fixtureDir = path.join(FIXTURES, "invalid/handler-wires");
    const caller = abs(fixtureDir, "src/compounds/vendors/reactions/handlers.ts");
    const decl = abs(fixtureDir, "src/compounds/vendors/adapters/VendorRepo.ts");
    const plugin = mockPluginWithSites({
      [caller]: [
        {
          callerAbsPath: caller,
          className: "VendorRepo",
          constructorDeclAbsPath: decl,
          isTransient: false,
        },
      ],
    });

    const { analyzeDiagnostics } = await runFixture(fixtureDir, { plugin });
    const hits = port004(analyzeDiagnostics);
    expect(hits).toHaveLength(1);
    const d = hits[0];
    expect(d.level).toBe("error");
    expect(d.compound).toBe("vendors");
    expect(d.message).toContain("VendorRepo");
    expect(d.message).toContain("vendors");
    expect(d.file).toBe(caller);
  });

  it("valid/catalyst-wires: catalyst compound calls new VendorRepo() → no PORT-004", async () => {
    const fixtureDir = path.join(FIXTURES, "valid/catalyst-wires");
    const caller = abs(fixtureDir, "src/compounds/wiring/reactions/apiServer.ts");
    const decl = abs(fixtureDir, "src/compounds/vendors/adapters/VendorRepo.ts");
    const plugin = mockPluginWithSites({
      [caller]: [
        {
          callerAbsPath: caller,
          className: "VendorRepo",
          constructorDeclAbsPath: decl,
          isTransient: false,
        },
      ],
    });

    const { analyzeDiagnostics } = await runFixture(fixtureDir, { plugin });
    expect(port004(analyzeDiagnostics)).toEqual([]);
  });

  it("valid/test-wires: test file calls new VendorRepo() → no PORT-004", async () => {
    const fixtureDir = path.join(FIXTURES, "valid/test-wires");
    const caller = abs(fixtureDir, "src/compounds/vendors/reactions/handlers.test.ts");
    const decl = abs(fixtureDir, "src/compounds/vendors/adapters/VendorRepo.ts");
    const plugin = mockPluginWithSites({
      [caller]: [
        {
          callerAbsPath: caller,
          className: "VendorRepo",
          constructorDeclAbsPath: decl,
          isTransient: false,
        },
      ],
    });

    const { analyzeDiagnostics } = await runFixture(fixtureDir, { plugin });
    expect(port004(analyzeDiagnostics)).toEqual([]);
  });

  it("valid/transient-tagged: @chemag-transient class instantiation → no PORT-004", async () => {
    const fixtureDir = path.join(FIXTURES, "valid/transient-tagged");
    const caller = abs(fixtureDir, "src/compounds/vendors/reactions/handlers.ts");
    const decl = abs(fixtureDir, "src/compounds/vendors/adapters/HttpClient.ts");
    const plugin = mockPluginWithSites({
      [caller]: [
        {
          callerAbsPath: caller,
          className: "HttpClient",
          constructorDeclAbsPath: decl,
          isTransient: true,
        },
      ],
    });

    const { analyzeDiagnostics } = await runFixture(fixtureDir, { plugin });
    expect(port004(analyzeDiagnostics)).toEqual([]);
  });

  it("valid/allowlisted: new Money() (default allowlist) → no PORT-004", async () => {
    const fixtureDir = path.join(FIXTURES, "valid/allowlisted");
    const caller = abs(fixtureDir, "src/compounds/vendors/reactions/handlers.ts");
    const decl = abs(fixtureDir, "src/compounds/vendors/adapters/Money.ts");
    const plugin = mockPluginWithSites({
      [caller]: [
        {
          callerAbsPath: caller,
          className: "Money",
          constructorDeclAbsPath: decl,
          isTransient: false,
        },
      ],
    });

    const { analyzeDiagnostics } = await runFixture(fixtureDir, { plugin });
    expect(port004(analyzeDiagnostics)).toEqual([]);
  });

  it("plugin without scanNewExpressions: skip — no PORT-004 emitted", async () => {
    // Same fixture that would fire PORT-004 with the mock plugin, but the
    // plugin here omits `scanNewExpressions` entirely. The core check
    // treats this as a skip — proves the plugin-python compatibility path.
    const fixtureDir = path.join(FIXTURES, "invalid/handler-wires");
    const plugin: LanguagePlugin = {
      ...NOOP_PLUGIN,
      name: "port-004-noscan",
      // scanNewExpressions intentionally absent.
    };
    const { analyzeDiagnostics } = await runFixture(fixtureDir, { plugin });
    expect(port004(analyzeDiagnostics)).toEqual([]);
  });
});
