// ---------------------------------------------------------------------------
// CHEM-PORT-003 — fixture-driven integration tests.
//
// These tests load each fixture via `runFixture(...)` with the REAL
// `typescriptPlugin` so that `declarationKind` is populated via ts-morph
// symbol resolution. The R02 mock-plugin pattern is unsuitable here because
// `declarationKind` is the load-bearing signal — a mock cannot produce it
// without re-implementing the resolver.
// ---------------------------------------------------------------------------
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { typescriptPlugin } from "@chemag/plugin-typescript";
import { runFixture } from "../helpers/run-fixture.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../fixtures/semantic-rules/port-003");

const port003 = (diags: { code: string }[]) => diags.filter((d) => d.code === "CHEM-PORT-003");

describe("CHEM-PORT-003 — fixture integration tests (real typescriptPlugin)", () => {
  it("valid/interface-import: cross-compound interface import → no PORT-003", async () => {
    const { analyzeDiagnostics } = await runFixture(path.join(FIXTURES, "valid/interface-import"), {
      plugin: typescriptPlugin,
    });
    expect(port003(analyzeDiagnostics)).toEqual([]);
  });

  it("valid/function-import: cross-compound function import → no PORT-003", async () => {
    const { analyzeDiagnostics } = await runFixture(path.join(FIXTURES, "valid/function-import"), {
      plugin: typescriptPlugin,
    });
    expect(port003(analyzeDiagnostics)).toEqual([]);
  });

  it("valid/type-import: cross-compound type-alias import → no PORT-003", async () => {
    const { analyzeDiagnostics } = await runFixture(path.join(FIXTURES, "valid/type-import"), {
      plugin: typescriptPlugin,
    });
    expect(port003(analyzeDiagnostics)).toEqual([]);
  });

  it("valid/pure-class-allowed: default-allowlisted (Money) + user-extended (CustomBigNum) → no PORT-003", async () => {
    const { analyzeDiagnostics } = await runFixture(
      path.join(FIXTURES, "valid/pure-class-allowed"),
      { plugin: typescriptPlugin },
    );
    expect(port003(analyzeDiagnostics)).toEqual([]);
  });

  it("valid/test-exemption: test-named source file importing a class → no PORT-003", async () => {
    const { analyzeDiagnostics } = await runFixture(path.join(FIXTURES, "valid/test-exemption"), {
      plugin: typescriptPlugin,
    });
    expect(port003(analyzeDiagnostics)).toEqual([]);
  });

  it("valid/reagent-exemption: class imported from a reagent compound → no PORT-003", async () => {
    const { analyzeDiagnostics } = await runFixture(
      path.join(FIXTURES, "valid/reagent-exemption"),
      { plugin: typescriptPlugin },
    );
    expect(port003(analyzeDiagnostics)).toEqual([]);
  });

  it("valid/transitive-reexport: B re-exports interface from C via barrel → no PORT-003", async () => {
    const { analyzeDiagnostics } = await runFixture(
      path.join(FIXTURES, "valid/transitive-reexport"),
      { plugin: typescriptPlugin },
    );
    expect(port003(analyzeDiagnostics)).toEqual([]);
  });

  it("invalid/class-import: cross-compound class import → PORT-003 fires exactly once", async () => {
    const { analyzeDiagnostics } = await runFixture(path.join(FIXTURES, "invalid/class-import"), {
      plugin: typescriptPlugin,
    });
    const hits = port003(analyzeDiagnostics);
    expect(hits).toHaveLength(1);
    const d = hits[0] as (typeof analyzeDiagnostics)[number];
    expect(d.level).toBe("error");
    expect(d.compound).toBe("a");
    expect(d.message).toContain("VendorRepository");
    expect(d.message).toContain("b");
    expect(d.file).toMatch(/useStore\.ts$/);
  });
});
