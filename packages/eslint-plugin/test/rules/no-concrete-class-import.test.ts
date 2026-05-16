// ---------------------------------------------------------------------------
// Fixture-driven tests for the `no-concrete-class-import` rule (PORT-003 port).
//
// Walks packages/core/test/fixtures/semantic-rules/port-003/{invalid,valid}.
// For each fixture, builds a TypeScript Program over the fixture's source
// tree, then runs ESLint with @typescript-eslint/parser configured to use
// that program (via parserOptions.programs).
//
// In addition, exercises a 6-deep barrel-chain fixture built in-memory to
// verify the depth-cap-5 behaviour (the resolver returns null past the cap
// and the rule does NOT fire).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeAll } from "vitest";
import { Linter } from "eslint";
import * as parser from "@typescript-eslint/parser";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { fileURLToPath } from "node:url";
import rule from "../../src/rules/no-concrete-class-import.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(here, "../../../core/test/fixtures/semantic-rules/port-003");

interface FixtureExpectation {
  rel: string;
  expectedDiagCount: number;
  /** Files to lint (relative to fixture root). If omitted, defaults to all .ts files NOT under reagents/ and NOT under interfaces/adapters/public/ unless they import. */
  filesToLint?: string[];
  /** Optional reagentRoots config (relative to fixture root). */
  reagentRoots?: string[];
  /** Optional extra class names to add to the allowlist (extends defaults). */
  classAllowlist?: string[];
}

/**
 * The per-fixture expectation is fixed up-front rather than discovered
 * automatically — diagnostic counts depend on which files we lint (the
 * reference chemag rule walks every cross-compound import edge once;
 * the ESLint rule lints per-file). Listing the consumer files explicitly
 * keeps the assertion deterministic.
 */
const FIXTURES: FixtureExpectation[] = [
  // --- INVALID ---
  {
    rel: "invalid/class-import",
    expectedDiagCount: 1,
    filesToLint: ["src/compounds/a/reactions/useStore.ts"],
  },
  // --- VALID ---
  {
    rel: "valid/function-import",
    expectedDiagCount: 0,
    filesToLint: ["src/compounds/a/reactions/useMoney.ts"],
  },
  {
    rel: "valid/interface-import",
    expectedDiagCount: 0,
    filesToLint: ["src/compounds/a/reactions/useStore.ts"],
  },
  {
    rel: "valid/pure-class-allowed",
    expectedDiagCount: 0,
    filesToLint: [
      "src/compounds/a/reactions/useBigNum.ts",
      "src/compounds/a/reactions/useMoney.ts",
    ],
    // Mirrors workspace.yaml's `rules.import_class_allowlist: [CustomBigNum]`.
    // `Money` is already in DEFAULT_CLASS_ALLOWLIST.
    classAllowlist: ["CustomBigNum"],
  },
  {
    rel: "valid/reagent-exemption",
    expectedDiagCount: 0,
    filesToLint: ["src/compounds/a/reactions/useForecast.ts"],
    reagentRoots: ["src/reagents"],
  },
  {
    rel: "valid/test-exemption",
    expectedDiagCount: 0,
    filesToLint: ["src/compounds/a/adapters/useStore.test.ts"],
  },
  {
    rel: "valid/transitive-reexport",
    expectedDiagCount: 0,
    filesToLint: ["src/compounds/a/reactions/useStore.ts"],
  },
  {
    rel: "valid/type-import",
    expectedDiagCount: 0,
    filesToLint: ["src/compounds/a/reactions/useVendor.ts"],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectAllTsFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    if (!fs.existsSync(dir)) continue;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === "dist") continue;
        stack.push(full);
        continue;
      }
      if (ent.isFile() && /\.tsx?$/.test(ent.name)) out.push(full);
    }
  }
  return out.sort();
}

function buildFixtureProgram(fixtureAbs: string): ts.Program {
  const files = collectAllTsFiles(fixtureAbs);
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: false,
    noEmit: true,
    esModuleInterop: true,
    skipLibCheck: true,
    allowImportingTsExtensions: false,
  };
  return ts.createProgram(files, compilerOptions);
}

function lintWithRule(opts: {
  fixtureAbs: string;
  program: ts.Program;
  files: string[];
  compoundsRoot: string;
  reagentRoots: string[];
  classAllowlist?: string[];
}): { ruleId: string | null; messageId?: string; file: string }[] {
  const linter = new Linter({ cwd: opts.fixtureAbs });
  const config: Linter.Config[] = [
    {
      files: ["**/*.ts", "**/*.tsx"],
      languageOptions: {
        parser,
        parserOptions: {
          programs: [opts.program],
        },
      },
      plugins: {
        "port-discipline": {
          rules: { "no-concrete-class-import": rule } as unknown as Record<
            string,
            Linter.RuleEntry
          >,
        },
      },
      rules: {
        "port-discipline/no-concrete-class-import": [
          "error",
          {
            compoundsRoot: opts.compoundsRoot,
            reagentRoots: opts.reagentRoots,
            ...(opts.classAllowlist ? { classAllowlist: opts.classAllowlist } : {}),
          },
        ],
      },
    },
  ];

  const out: { ruleId: string | null; messageId?: string; file: string }[] = [];
  for (const f of opts.files) {
    const src = fs.readFileSync(f, "utf8");
    const msgs = linter.verify(src, config, { filename: f });
    for (const m of msgs) {
      if (m.ruleId === "port-discipline/no-concrete-class-import") {
        out.push({ ruleId: m.ruleId, messageId: m.messageId, file: f });
      } else if (m.ruleId === null) {
        // Surface fatal parser errors so failing assertions have context.
        // eslint-disable-next-line no-console
        console.error(`[${f}] non-rule message:`, m);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fixture-driven tests
// ---------------------------------------------------------------------------

describe("no-concrete-class-import rule (PORT-003 port) — fixture-driven", () => {
  for (const fx of FIXTURES) {
    it(`${fx.rel} → ${fx.expectedDiagCount} diagnostic(s)`, () => {
      const fixtureAbs = path.join(FIXTURES_ROOT, fx.rel);
      const compoundsRoot = path.join(fixtureAbs, "src/compounds");
      const reagentRoots = (fx.reagentRoots ?? []).map((r) => path.join(fixtureAbs, r));
      const program = buildFixtureProgram(fixtureAbs);

      const files = (fx.filesToLint ?? []).map((f) => path.join(fixtureAbs, f));

      const diags = lintWithRule({
        fixtureAbs,
        program,
        files,
        compoundsRoot,
        reagentRoots,
        classAllowlist: fx.classAllowlist,
      });

      if (diags.length !== fx.expectedDiagCount) {
        // eslint-disable-next-line no-console
        console.error(`[${fx.rel}] expected ${fx.expectedDiagCount}, got`, diags);
      }
      expect(diags.length).toBe(fx.expectedDiagCount);
    });
  }
});

// ---------------------------------------------------------------------------
// Depth-cap-5 test — programmatic 6-deep barrel chain.
// ---------------------------------------------------------------------------

describe("no-concrete-class-import — depth-cap behaviour", () => {
  it("does NOT fire on a 6-deep barrel chain (chain exceeds maxDepth=5; resolveImportedSymbol returns null)", () => {
    const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "port-003-depth-"));
    // Build a project where compound A's reaction imports a class from compound B
    // through 6 barrel re-exports. depth cap = 5 → unresolvable → no fire.
    const layout: Record<string, string> = {
      "src/compounds/a/compound.yaml": "compound: a\nunits: []\n",
      "src/compounds/a/reactions/useDeep.ts": `import { Deep } from "../../b/public";\nexport function u(): Deep { return new Deep(); }\n`,
      "src/compounds/b/compound.yaml": "compound: b\nunits: []\n",
      "src/compounds/b/adapters/Deep.ts": "export class Deep {}\n",
      "src/compounds/b/barrel5.ts": `export { Deep } from "./adapters/Deep";\n`,
      "src/compounds/b/barrel4.ts": `export { Deep } from "./barrel5";\n`,
      "src/compounds/b/barrel3.ts": `export { Deep } from "./barrel4";\n`,
      "src/compounds/b/barrel2.ts": `export { Deep } from "./barrel3";\n`,
      "src/compounds/b/barrel1.ts": `export { Deep } from "./barrel2";\n`,
      "src/compounds/b/barrel0.ts": `export { Deep } from "./barrel1";\n`,
      "src/compounds/b/public.ts": `export { Deep } from "./barrel0";\n`,
    };

    for (const [rel, content] of Object.entries(layout)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }

    const program = buildFixtureProgram(tmp);
    const compoundsRoot = path.join(tmp, "src/compounds");
    const files = [path.join(tmp, "src/compounds/a/reactions/useDeep.ts")];
    const diags = lintWithRule({
      fixtureAbs: tmp,
      program,
      files,
      compoundsRoot,
      reagentRoots: [],
    });

    expect(diags.length).toBe(0);
  });

  it("fires on a 1-hop barrel chain (basic re-export resolves correctly)", () => {
    // Sanity check: a single barrel re-export does resolve to the class and
    // the rule fires. The fixture `invalid/class-import` already covers this
    // path, but we replicate here to exercise the rule against an isolated
    // in-memory layout (mirrors the structure of the depth-6 test).
    const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "port-003-depth1-"));
    const layout: Record<string, string> = {
      "src/compounds/a/compound.yaml": "compound: a\nunits: []\n",
      "src/compounds/a/reactions/useShallow.ts": `import { Shallow } from "../../b/public";\nexport function u(): Shallow { return new Shallow(); }\n`,
      "src/compounds/b/compound.yaml": "compound: b\nunits: []\n",
      "src/compounds/b/adapters/Shallow.ts": "export class Shallow {}\n",
      "src/compounds/b/public.ts": `export { Shallow } from "./adapters/Shallow";\n`,
    };

    for (const [rel, content] of Object.entries(layout)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }

    const program = buildFixtureProgram(tmp);
    const compoundsRoot = path.join(tmp, "src/compounds");
    const files = [path.join(tmp, "src/compounds/a/reactions/useShallow.ts")];
    const diags = lintWithRule({
      fixtureAbs: tmp,
      program,
      files,
      compoundsRoot,
      reagentRoots: [],
    });

    expect(diags.length).toBe(1);
  });
});
