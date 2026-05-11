import { describe, it, expect, vi } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runFixture, NOOP_PLUGIN } from "./run-fixture.js";
import type { LanguagePlugin } from "../../src/plugin-interface.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../fixtures/semantic-rules");

describe("runFixture", () => {
  it("fires CHEM-MANIFEST-001 for the duplicate-compound baseline fixture", async () => {
    const fixtureDir = path.join(FIXTURES, "_baseline/invalid/duplicate-compound");
    const { checkDiagnostics, analyzeDiagnostics } = await runFixture(fixtureDir);

    const codes = checkDiagnostics.map((d) => d.code);
    expect(codes).toContain("CHEM-MANIFEST-001");
    // The no-op plugin emits no source-level diagnostics.
    expect(analyzeDiagnostics).toEqual([]);
  });

  it("returns empty arrays for the valid empty-workspace baseline fixture", async () => {
    const fixtureDir = path.join(FIXTURES, "_baseline/valid/empty-workspace");
    const { checkDiagnostics, analyzeDiagnostics } = await runFixture(fixtureDir);

    expect(checkDiagnostics).toEqual([]);
    expect(analyzeDiagnostics).toEqual([]);
  });

  it("exercises the analyze seam: calls the injected plugin's parseImportsBatch", async () => {
    // The single-compound fixture has one element unit, so checkImports has a
    // non-empty file list and must invoke parseImportsBatch on the plugin.
    const fixtureDir = path.join(FIXTURES, "_baseline/valid/single-compound");

    const parseImportsBatch = vi.fn().mockReturnValue(new Map());
    const spyPlugin: LanguagePlugin = {
      ...NOOP_PLUGIN,
      name: "spy",
      parseImportsBatch,
    };

    const { checkDiagnostics, analyzeDiagnostics } = await runFixture(fixtureDir, {
      plugin: spyPlugin,
    });

    expect(checkDiagnostics).toEqual([]);
    expect(analyzeDiagnostics).toEqual([]);
    // The analyze phase ran end-to-end: parseImportsBatch was invoked with
    // the unit file's absolute path.
    expect(parseImportsBatch).toHaveBeenCalledTimes(1);
    const [paths] = parseImportsBatch.mock.calls[0] as [string[]];
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/elements\/X\.ts$/);
  });

  it("is deterministic across repeated invocations", async () => {
    const fixtureDir = path.join(FIXTURES, "_baseline/invalid/duplicate-compound");
    const a = await runFixture(fixtureDir);
    const b = await runFixture(fixtureDir);
    expect(a.checkDiagnostics.map((d) => d.code).sort()).toEqual(
      b.checkDiagnostics.map((d) => d.code).sort(),
    );
    expect(a.analyzeDiagnostics).toEqual(b.analyzeDiagnostics);
  });
});
