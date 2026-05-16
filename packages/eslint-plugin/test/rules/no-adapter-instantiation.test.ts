// ---------------------------------------------------------------------------
// Fixture-driven tests for the `no-adapter-instantiation` rule (PORT-004 port).
//
// Walks packages/core/test/fixtures/semantic-rules/port-004/{invalid,valid}.
// Bench-derived extension: the `valid/error-subclass` fixture exercises the
// Error-allowlist (created as part of this stage).
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { Linter } from "eslint";
import * as parser from "@typescript-eslint/parser";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { fileURLToPath } from "node:url";
import rule from "../../src/rules/no-adapter-instantiation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(here, "../../../core/test/fixtures/semantic-rules/port-004");

interface FixtureExpectation {
  rel: string;
  expectedDiagCount: number;
  /** Files to lint, relative to fixture root. */
  filesToLint: string[];
  /** Compounds to treat as catalysts (mirrors chemag's `type: catalyst`). */
  catalystCompounds?: string[];
  /** Override classAllowlist (extends defaults). */
  classAllowlist?: string[];
  /** Override the Error-allowlist default (true). */
  allowErrorSubclasses?: boolean;
}

const FIXTURES: FixtureExpectation[] = [
  // --- INVALID ---
  {
    rel: "invalid/handler-wires",
    expectedDiagCount: 1,
    filesToLint: ["src/compounds/vendors/reactions/handlers.ts"],
  },
  // --- VALID ---
  {
    rel: "valid/allowlisted",
    expectedDiagCount: 0,
    filesToLint: ["src/compounds/vendors/reactions/handlers.ts"],
    // `Money` is in the default allowlist already; no override needed.
  },
  {
    rel: "valid/catalyst-wires",
    expectedDiagCount: 0,
    filesToLint: ["src/compounds/wiring/reactions/apiServer.ts"],
    // The chemag fixture marks `wiring` as `type: catalyst`. The ESLint
    // port exposes this as the `catalystCompounds` option.
    catalystCompounds: ["wiring"],
  },
  {
    rel: "valid/test-wires",
    expectedDiagCount: 0,
    filesToLint: ["src/compounds/vendors/reactions/handlers.test.ts"],
  },
  {
    rel: "valid/transient-tagged",
    expectedDiagCount: 0,
    filesToLint: ["src/compounds/vendors/reactions/handlers.ts"],
  },
  // --- VALID (NEW — bench-derived Error allowlist) ---
  {
    rel: "valid/error-subclass",
    expectedDiagCount: 0,
    filesToLint: ["src/compounds/vendors/reactions/handlers.ts"],
  },
];

// ---------------------------------------------------------------------------
// Helpers (same shape as no-concrete-class-import.test.ts)
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
  };
  return ts.createProgram(files, compilerOptions);
}

function lintWithRule(opts: {
  fixtureAbs: string;
  program: ts.Program;
  files: string[];
  compoundsRoot: string;
  catalystCompounds?: string[];
  classAllowlist?: string[];
  allowErrorSubclasses?: boolean;
}): { ruleId: string | null; messageId?: string; file: string }[] {
  const linter = new Linter({ cwd: opts.fixtureAbs });
  const ruleOpts: Record<string, unknown> = { compoundsRoot: opts.compoundsRoot };
  if (opts.catalystCompounds) ruleOpts.catalystCompounds = opts.catalystCompounds;
  if (opts.classAllowlist) ruleOpts.classAllowlist = opts.classAllowlist;
  if (opts.allowErrorSubclasses !== undefined) {
    ruleOpts.allowErrorSubclasses = opts.allowErrorSubclasses;
  }
  const config: Linter.Config[] = [
    {
      files: ["**/*.ts", "**/*.tsx"],
      languageOptions: {
        parser,
        parserOptions: { programs: [opts.program] },
      },
      plugins: {
        "port-discipline": {
          rules: { "no-adapter-instantiation": rule } as unknown as Record<
            string,
            Linter.RuleEntry
          >,
        },
      },
      rules: {
        "port-discipline/no-adapter-instantiation": ["error", ruleOpts],
      },
    },
  ];

  const out: { ruleId: string | null; messageId?: string; file: string }[] = [];
  for (const f of opts.files) {
    const src = fs.readFileSync(f, "utf8");
    const msgs = linter.verify(src, config, { filename: f });
    for (const m of msgs) {
      if (m.ruleId === "port-discipline/no-adapter-instantiation") {
        out.push({ ruleId: m.ruleId, messageId: m.messageId, file: f });
      } else if (m.ruleId === null) {
        // eslint-disable-next-line no-console
        console.error(`[${f}] non-rule message:`, m);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("no-adapter-instantiation rule (PORT-004 port) — fixture-driven", () => {
  for (const fx of FIXTURES) {
    it(`${fx.rel} → ${fx.expectedDiagCount} diagnostic(s)`, () => {
      const fixtureAbs = path.join(FIXTURES_ROOT, fx.rel);
      const compoundsRoot = path.join(fixtureAbs, "src/compounds");
      const program = buildFixtureProgram(fixtureAbs);
      const files = fx.filesToLint.map((f) => path.join(fixtureAbs, f));

      const diags = lintWithRule({
        fixtureAbs,
        program,
        files,
        compoundsRoot,
        catalystCompounds: fx.catalystCompounds,
        classAllowlist: fx.classAllowlist,
        allowErrorSubclasses: fx.allowErrorSubclasses,
      });

      if (diags.length !== fx.expectedDiagCount) {
        // eslint-disable-next-line no-console
        console.error(`[${fx.rel}] expected ${fx.expectedDiagCount}, got`, diags);
      }
      expect(diags.length).toBe(fx.expectedDiagCount);
    });
  }
});

describe("no-adapter-instantiation — Error-allowlist opt-out", () => {
  it("error-subclass fires exactly 1 diagnostic when allowErrorSubclasses: false", () => {
    const fixtureAbs = path.join(FIXTURES_ROOT, "valid/error-subclass");
    const compoundsRoot = path.join(fixtureAbs, "src/compounds");
    const program = buildFixtureProgram(fixtureAbs);
    const files = [path.join(fixtureAbs, "src/compounds/vendors/reactions/handlers.ts")];

    const diags = lintWithRule({
      fixtureAbs,
      program,
      files,
      compoundsRoot,
      allowErrorSubclasses: false,
    });

    expect(diags.length).toBe(1);
  });
});
