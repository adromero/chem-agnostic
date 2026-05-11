// ---------------------------------------------------------------------------
// CHEM-PORT-001 — fixture + unit tests.
//
// Fixture tests drive `runFixture(...)` with an inline mock plugin built from
// NOOP_PLUGIN (CLAUDE.md constraint forbids importing @chemag/plugin-*
// from @chemag/core test code). Unit tests drive the pure
// checkPortNeedsInterface / compileIoModulePatterns functions directly.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runFixture, NOOP_PLUGIN } from "../helpers/run-fixture.js";
import { assertDiagnosticCodes } from "../helpers/assert-diagnostics.js";
import {
  IO_MODULE_PATTERNS,
  checkPortNeedsInterface,
  compileIoModulePatterns,
} from "../../src/checks/port-needs-interface.js";
import type { LanguagePlugin } from "../../src/plugin-interface.js";
import type { LoadedCompound, ParsedImport } from "../../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../fixtures/semantic-rules/port-001");

/**
 * Build an inline mock plugin whose `parseImportsBatch` returns a per-file
 * map of `ParsedImport[]`. Modelled on the `spyPlugin` pattern in
 * `run-fixture.test.ts`. We override `parseImportsBatch` only — every other
 * method delegates to NOOP_PLUGIN so the analyze pipeline runs end-to-end
 * without side effects.
 *
 * `importsByBasename` is keyed by file BASENAME (e.g. "store.ts") so tests
 * stay independent of the temp-resolved absolute paths the fixture loader
 * produces. The mock resolves keys at parseImportsBatch invocation time.
 */
function mockPluginByBasename(importsByBasename: Record<string, ParsedImport[]>): LanguagePlugin {
  return {
    ...NOOP_PLUGIN,
    name: "port-001-mock",
    parseImportsBatch(paths: string[]): Map<string, ParsedImport[]> {
      const out = new Map<string, ParsedImport[]>();
      for (const abs of paths) {
        const base = path.basename(abs);
        const imps = importsByBasename[base];
        if (imps) out.set(abs, imps);
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture tests — consume analyzeDiagnostics (PORT-001 is analyze-phase)
// ---------------------------------------------------------------------------

describe("CHEM-PORT-001 — fixture tests", () => {
  it("valid/has-port: compound declares an interface; no PORT-001", async () => {
    const plugin = mockPluginByBasename({
      "store.ts": [{ moduleSpecifier: "better-sqlite3", names: ["default"], isTypeOnly: false }],
    });
    const { analyzeDiagnostics } = await runFixture(path.join(FIXTURES, "valid/has-port"), {
      plugin,
    });
    expect(analyzeDiagnostics.filter((d) => d.code === "CHEM-PORT-001")).toEqual([]);
  });

  it("valid/no-orchestration: only adapter units, no reaction → no PORT-001", async () => {
    const plugin = mockPluginByBasename({
      "store.ts": [{ moduleSpecifier: "better-sqlite3", names: ["default"], isTypeOnly: false }],
    });
    const { analyzeDiagnostics } = await runFixture(path.join(FIXTURES, "valid/no-orchestration"), {
      plugin,
    });
    expect(analyzeDiagnostics.filter((d) => d.code === "CHEM-PORT-001")).toEqual([]);
  });

  it("valid/no-io: adapter imports only non-I/O modules → no PORT-001", async () => {
    // Positively verify the absence of I/O: the mock returns a non-empty
    // ParsedImport[] containing only non-I/O specifiers (mirrors what a real
    // plugin would do for a pure data-mapping adapter).
    const plugin = mockPluginByBasename({
      "store.ts": [
        { moduleSpecifier: "./util", names: ["normalize"], isTypeOnly: false },
        { moduleSpecifier: "lodash", names: ["pick"], isTypeOnly: false },
      ],
      "handlers.ts": [{ moduleSpecifier: "./util", names: ["normalize"], isTypeOnly: false }],
    });
    const { analyzeDiagnostics } = await runFixture(path.join(FIXTURES, "valid/no-io"), { plugin });
    expect(analyzeDiagnostics.filter((d) => d.code === "CHEM-PORT-001")).toEqual([]);
  });

  it("invalid/missing-port: adapter imports better-sqlite3 → PORT-001 fires once", async () => {
    const plugin = mockPluginByBasename({
      "store.ts": [{ moduleSpecifier: "better-sqlite3", names: ["default"], isTypeOnly: false }],
    });
    const { analyzeDiagnostics } = await runFixture(path.join(FIXTURES, "invalid/missing-port"), {
      plugin,
    });
    const portDiags = analyzeDiagnostics.filter((d) => d.code === "CHEM-PORT-001");
    expect(portDiags).toHaveLength(1);
    expect(portDiags[0].level).toBe("warning");
    expect(portDiags[0].compound).toBe("vendors");
    expect(portDiags[0].message).toContain("better-sqlite3");
  });

  it("invalid/missing-port-multi-io: two adapters with I/O imports → PORT-001 fires exactly once (per compound, not per adapter)", async () => {
    const plugin = mockPluginByBasename({
      "store-sqlite.ts": [
        { moduleSpecifier: "better-sqlite3", names: ["default"], isTypeOnly: false },
      ],
      "store-pg.ts": [{ moduleSpecifier: "pg", names: ["Pool"], isTypeOnly: false }],
    });
    const { analyzeDiagnostics } = await runFixture(
      path.join(FIXTURES, "invalid/missing-port-multi-io"),
      { plugin },
    );
    assertDiagnosticCodes(
      analyzeDiagnostics.filter((d) => d.code === "CHEM-PORT-001"),
      { codes: ["CHEM-PORT-001"] },
    );
    const portDiag = analyzeDiagnostics.find((d) => d.code === "CHEM-PORT-001");
    expect(portDiag!.message).toMatch(/better-sqlite3/);
    expect(portDiag!.message).toMatch(/\bpg\b/);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — pure functions, no fixture
// ---------------------------------------------------------------------------

describe("compileIoModulePatterns", () => {
  it("returns the defaults when no user patterns supplied", () => {
    const out = compileIoModulePatterns(undefined);
    expect(out).toHaveLength(IO_MODULE_PATTERNS.length);
  });

  it("extends — does not replace — the default allowlist with user patterns", () => {
    const userExtras = ["^kafka-node$"];
    const out = compileIoModulePatterns(userExtras);
    expect(out.length).toBe(IO_MODULE_PATTERNS.length + 1);
    expect(out.some((re) => re.test("better-sqlite3"))).toBe(true);
    expect(out.some((re) => re.test("kafka-node"))).toBe(true);
  });

  it("covers Node built-ins in both bare and node: prefix forms", () => {
    const out = compileIoModulePatterns(undefined);
    expect(out.some((re) => re.test("fs"))).toBe(true);
    expect(out.some((re) => re.test("node:fs"))).toBe(true);
    expect(out.some((re) => re.test("fs/promises"))).toBe(true);
    expect(out.some((re) => re.test("node:fs/promises"))).toBe(true);
    expect(out.some((re) => re.test("http"))).toBe(true);
    expect(out.some((re) => re.test("node:http"))).toBe(true);
  });
});

describe("checkPortNeedsInterface — direct invocation (no fixture)", () => {
  const patterns = compileIoModulePatterns(undefined);

  function makeCompound(units: { role: string; name: string; file: string }[]): LoadedCompound {
    return {
      manifest: { compound: "vendors", units },
      dir: "/synthetic/compounds/vendors",
    };
  }

  it("returns undefined when there is no reaction unit", () => {
    const compound = makeCompound([
      { role: "adapter", name: "store", file: "./adapters/store.ts" },
    ]);
    const importsForFile = (_abs: string): ParsedImport[] => [
      { moduleSpecifier: "better-sqlite3", names: ["default"], isTypeOnly: false },
    ];
    expect(checkPortNeedsInterface(compound, importsForFile, patterns, "default")).toBeUndefined();
  });

  it("returns undefined when there is no adapter unit", () => {
    const compound = makeCompound([
      { role: "reaction", name: "handlers", file: "./reactions/handlers.ts" },
    ]);
    const importsForFile = (_abs: string): ParsedImport[] => [];
    expect(checkPortNeedsInterface(compound, importsForFile, patterns, "default")).toBeUndefined();
  });

  it("returns undefined when an interface unit already exists", () => {
    const compound = makeCompound([
      { role: "reaction", name: "handlers", file: "./reactions/handlers.ts" },
      { role: "interface", name: "store-port", file: "./interfaces/store-port.ts" },
      { role: "adapter", name: "store", file: "./adapters/store.ts" },
    ]);
    const importsForFile = (abs: string): ParsedImport[] => {
      if (abs.endsWith("store.ts")) {
        return [{ moduleSpecifier: "better-sqlite3", names: ["default"], isTypeOnly: false }];
      }
      return [];
    };
    expect(checkPortNeedsInterface(compound, importsForFile, patterns, "default")).toBeUndefined();
  });

  it("returns undefined when adapters import zero I/O modules", () => {
    const compound = makeCompound([
      { role: "reaction", name: "handlers", file: "./reactions/handlers.ts" },
      { role: "adapter", name: "store", file: "./adapters/store.ts" },
    ]);
    const importsForFile = (abs: string): ParsedImport[] => {
      if (abs.endsWith("store.ts")) {
        return [
          { moduleSpecifier: "lodash", names: ["pick"], isTypeOnly: false },
          { moduleSpecifier: "./util", names: ["x"], isTypeOnly: false },
        ];
      }
      return [];
    };
    expect(checkPortNeedsInterface(compound, importsForFile, patterns, "default")).toBeUndefined();
  });

  it("returns exactly one diagnostic when reactions+adapter(s)+no-interface+I/O-import all hold", () => {
    const compound = makeCompound([
      { role: "reaction", name: "handlers", file: "./reactions/handlers.ts" },
      { role: "adapter", name: "store-a", file: "./adapters/store-a.ts" },
      { role: "adapter", name: "store-b", file: "./adapters/store-b.ts" },
    ]);
    const importsForFile = (abs: string): ParsedImport[] => {
      if (abs.endsWith("store-a.ts")) {
        return [{ moduleSpecifier: "better-sqlite3", names: ["default"], isTypeOnly: false }];
      }
      if (abs.endsWith("store-b.ts")) {
        return [{ moduleSpecifier: "pg", names: ["Pool"], isTypeOnly: false }];
      }
      return [];
    };
    const diag = checkPortNeedsInterface(compound, importsForFile, patterns, "default");
    expect(diag).toBeDefined();
    expect(diag!.code).toBe("CHEM-PORT-001");
    expect(diag!.level).toBe("warning");
    expect(diag!.compound).toBe("vendors");
    expect(diag!.language_id).toBe("default");
    // Cardinality contract: 0 or 1 — direct returns reflect this. The
    // "exactly once per compound" property at the analyze layer is exercised
    // by the `missing-port-multi-io` fixture test above.
  });
});
