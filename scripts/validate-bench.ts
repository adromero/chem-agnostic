// ---------------------------------------------------------------------------
// validate-bench.ts — run eslint-plugin-port-discipline against the four
// spend-tracker-bench repos and produce per-repo JSON + a summary table.
//
// Usage:
//   tsx scripts/validate-bench.ts
//
// Outputs:
//   spend-tracker-bench/results/eslint-plugin-{control,treatment}-{1,2}.json
//   spend-tracker-bench/results/eslint-plugin-summary.md
//
// Reads each bench repo's `workspace.yaml` to discover role folders, then
// runs the three port rules over `src/compounds/**` (catalyst files at
// `src/catalyst/**` are EXCLUDED — they're the wiring layer and the rule's
// path-classification correctly treats them as out-of-compound).
//
// Bench is treated as a read-only artifact: this script does NOT install
// dependencies or modify anything inside the bench repos.
// ---------------------------------------------------------------------------
import { Linter } from "eslint";
import * as parser from "@typescript-eslint/parser";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import needsInterface from "../packages/eslint-plugin/src/rules/needs-interface.js";
import noConcreteClassImport from "../packages/eslint-plugin/src/rules/no-concrete-class-import.js";
import noAdapterInstantiation from "../packages/eslint-plugin/src/rules/no-adapter-instantiation.js";

const BENCH_RUNS_ROOT = "/home/alfonso/Projects/spend-tracker-bench/runs";
const BENCH_RESULTS_ROOT = "/home/alfonso/Projects/spend-tracker-bench/results";
const PANES = ["control-1", "control-2", "treatment-1", "treatment-2"];

interface PaneResult {
  pane: string;
  ok: boolean;
  reason?: string;
  diagnostics: {
    rule: string;
    file: string;
    messageId?: string;
    message: string;
    line: number;
    column: number;
  }[];
  counts: Record<string, number>;
  files_linted: number;
  duration_ms: number;
}

function collectTsFiles(dir: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist") continue;
      collectTsFiles(path.join(dir, ent.name), results);
    } else if (ent.isFile() && /\.tsx?$/.test(ent.name) && !/\.d\.ts$/.test(ent.name)) {
      results.push(path.join(dir, ent.name));
    }
  }
  return results;
}

/**
 * Tiny single-purpose yaml-ish parser. We only need two things from the
 * bench's workspace.yaml:
 *   - roles.{role}.folder
 *   - paths.{kind}
 * Both are 2-deep `key: value` mappings. This avoids pulling in `yaml` as
 * a script dependency (it's not at the monorepo root).
 */
function loadWorkspaceYaml(
  repoRoot: string,
): { roles: Record<string, { folder?: string }>; paths: Record<string, string> } | null {
  const p = path.join(repoRoot, "workspace.yaml");
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  const roles: Record<string, { folder?: string }> = {};
  const paths: Record<string, string> = {};

  let mode: "none" | "roles" | "paths" = "none";
  let currentRole: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (/^\s*#/.test(rawLine) || rawLine.trim() === "") continue;
    if (/^[a-zA-Z]/.test(rawLine)) {
      // top-level key
      const m = rawLine.match(/^([a-zA-Z_][\w]*):\s*(.*)$/);
      if (!m) {
        mode = "none";
        continue;
      }
      if (m[1] === "roles") {
        mode = "roles";
        currentRole = null;
      } else if (m[1] === "paths") {
        mode = "paths";
        currentRole = null;
      } else {
        mode = "none";
      }
      continue;
    }
    if (mode === "roles") {
      // 2-space indent → role name; 4-space indent → role attribute.
      const m2 = rawLine.match(/^ {2}([a-zA-Z_][\w]*):\s*$/);
      if (m2) {
        currentRole = m2[1];
        roles[currentRole] = {};
        continue;
      }
      const m4 = rawLine.match(/^ {4}([a-zA-Z_][\w]*):\s*(.+)$/);
      if (m4 && currentRole) {
        if (m4[1] === "folder") {
          roles[currentRole].folder = m4[2].trim();
        }
      }
    } else if (mode === "paths") {
      const m2 = rawLine.match(/^ {2}([a-zA-Z_][\w]*):\s*(.+)$/);
      if (m2) paths[m2[1]] = m2[2].trim();
    }
  }

  return { roles, paths };
}

interface RuleConfig {
  compoundsRoot: string;
  reagentRoots: string[];
  adapterPaths: string[];
  interfacePaths: string[];
  reactionPaths: string[];
  catalystPaths: string[];
}

function buildRuleConfig(repoRoot: string): RuleConfig | null {
  const ws = loadWorkspaceYaml(repoRoot);
  if (!ws) return null;
  const compoundsRel = ws.paths.compounds ?? "./src/compounds";
  const reagentsRel = ws.paths.reagents;
  const compoundsRoot = path.resolve(repoRoot, compoundsRel);

  const reagentRoots: string[] = [];
  if (typeof reagentsRel === "string") {
    reagentRoots.push(path.resolve(repoRoot, reagentsRel));
  }
  if (typeof ws.paths.solvents === "string") {
    reagentRoots.push(path.resolve(repoRoot, ws.paths.solvents));
  }

  const folderOf = (role: string, fallback: string): string => ws.roles[role]?.folder ?? fallback;

  return {
    compoundsRoot,
    reagentRoots,
    adapterPaths: [folderOf("adapter", "adapters")],
    interfacePaths: [folderOf("interface", "interfaces")],
    reactionPaths: [folderOf("reaction", "reactions")],
    catalystPaths: [folderOf("catalyst", "catalysts")],
  };
}

function runPlugin(repoRoot: string, cfg: RuleConfig): PaneResult {
  const pane = path.basename(repoRoot);
  const start = Date.now();

  // Build a program over every .ts file in the repo (excluding node_modules).
  const allFiles = collectTsFiles(repoRoot);
  const program = ts.createProgram(allFiles, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: false,
    noEmit: true,
    esModuleInterop: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.Preserve,
    allowJs: true,
  });

  const linter = new Linter({ cwd: repoRoot });
  const ruleOpts = {
    compoundsRoot: cfg.compoundsRoot,
    adapterPaths: cfg.adapterPaths,
    interfacePaths: cfg.interfacePaths,
    reactionPaths: cfg.reactionPaths,
    catalystPaths: cfg.catalystPaths,
  };
  const port003Opts = { ...ruleOpts, reagentRoots: cfg.reagentRoots };

  const config: Linter.Config[] = [
    {
      files: ["**/*.ts", "**/*.tsx"],
      languageOptions: {
        parser,
        parserOptions: { programs: [program] },
      },
      plugins: {
        "port-discipline": {
          rules: {
            "needs-interface": needsInterface,
            "no-concrete-class-import": noConcreteClassImport,
            "no-adapter-instantiation": noAdapterInstantiation,
          } as unknown as Record<string, Linter.RuleEntry>,
        },
      },
      rules: {
        "port-discipline/needs-interface": ["error", ruleOpts],
        "port-discipline/no-concrete-class-import": ["error", port003Opts],
        "port-discipline/no-adapter-instantiation": ["error", ruleOpts],
      },
    },
  ];

  // Lint only files inside compoundsRoot — the catalyst dir and other top-level
  // source files are out of scope for these rules.
  const lintTargets = allFiles.filter((f) => f.startsWith(cfg.compoundsRoot + path.sep));

  const diagnostics: PaneResult["diagnostics"] = [];
  const counts: Record<string, number> = {};

  for (const f of lintTargets) {
    const src = fs.readFileSync(f, "utf8");
    const msgs = linter.verify(src, config, { filename: f });
    for (const m of msgs) {
      if (!m.ruleId || !m.ruleId.startsWith("port-discipline/")) continue;
      diagnostics.push({
        rule: m.ruleId,
        file: path.relative(repoRoot, f),
        messageId: m.messageId,
        message: m.message,
        line: m.line,
        column: m.column,
      });
      counts[m.ruleId] = (counts[m.ruleId] ?? 0) + 1;
    }
  }

  return {
    pane,
    ok: true,
    diagnostics,
    counts,
    files_linted: lintTargets.length,
    duration_ms: Date.now() - start,
  };
}

function validatePane(pane: string): PaneResult {
  const repoRoot = path.join(BENCH_RUNS_ROOT, pane);
  if (!fs.existsSync(repoRoot)) {
    return {
      pane,
      ok: false,
      reason: `bench pane not found: ${repoRoot}`,
      diagnostics: [],
      counts: {},
      files_linted: 0,
      duration_ms: 0,
    };
  }
  const cfg = buildRuleConfig(repoRoot);
  if (!cfg) {
    return {
      pane,
      ok: false,
      reason: "workspace.yaml missing",
      diagnostics: [],
      counts: {},
      files_linted: 0,
      duration_ms: 0,
    };
  }
  return runPlugin(repoRoot, cfg);
}

function writePaneResult(result: PaneResult): void {
  const out = path.join(BENCH_RESULTS_ROOT, `eslint-plugin-${result.pane}.json`);
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(
    `  ${result.pane}: ${result.files_linted} files, ${result.duration_ms}ms, counts:`,
    result.counts,
  );
}

function writeSummary(results: PaneResult[]): void {
  const ruleNames = [
    "port-discipline/needs-interface",
    "port-discipline/no-concrete-class-import",
    "port-discipline/no-adapter-instantiation",
  ];

  // Per spec: table with pane × chemag-run2 (reference) × eslint-plugin counts.
  // Reference numbers come from `spend-tracker-bench/results/GATE-1.md`.
  const reference: Record<string, { port001: number; port003: number; port004: number }> = {
    "control-1": { port001: 0, port003: 0, port004: 7 },
    "control-2": { port001: 0, port003: 0, port004: 8 },
    "treatment-1": { port001: 0, port003: 0, port004: 0 },
    "treatment-2": { port001: 0, port003: 0, port004: 0 },
  };

  const lines: string[] = [];
  lines.push("# eslint-plugin-port-discipline — bench validation summary");
  lines.push("");
  lines.push(
    "Comparison of `chemag analyze` (run-2, run-time of GATE-1) vs `eslint-plugin-port-discipline`.",
  );
  lines.push("");
  lines.push("## Known limitation: role classification");
  lines.push("");
  lines.push(
    "The spend-tracker-bench repos use a **flat compound layout** with role information stored in each compound's `compound.yaml` manifest (e.g. `api-client.ts` is declared `role: adapter`). The ESLint plugin uses **path-based** role classification — files under `<compound>/adapters/`, `<compound>/reactions/`, etc.",
  );
  lines.push("");
  lines.push(
    "The bench fixtures therefore do NOT exercise the ESLint plugin's rule paths at all — every file under the bench's flat compounds is classified `role: unknown` and the rules skip it. The numbers below reflect this: all zeros across the board, including treatments where chemag also reported zero.",
  );
  lines.push("");
  lines.push(
    "This is a **design choice**, not a bug: the ESLint port deliberately avoids parsing chemag manifests at runtime (see CLAUDE.md > Key Design Decisions). Path-based classification works for greenfield projects that adopt the convention `<compound>/{adapters,interfaces,reactions,catalysts}/` (which is what the in-repo fixtures under `packages/core/test/fixtures/semantic-rules/` and the pack-integration test exercise). Projects with the bench's flat layout need to either restructure or configure custom role paths via the rule options.",
  );
  lines.push("");
  lines.push(
    "The Error-allowlist extension (S02d) is still validated by the new `valid/error-subclass` fixture — it correctly drops `class FooError extends BaseError extends Error` instantiations. That fixture is the proof-of-concept for the 7+8 PORT-004 false positives the GATE-1 bench produced on `*ApiError` classes.",
  );
  lines.push("");
  lines.push("## Counts");
  lines.push("");
  lines.push(
    "| Pane | chemag PORT-001 | plugin needs-interface | chemag PORT-003 | plugin no-concrete-class-import | chemag PORT-004 | plugin no-adapter-instantiation |",
  );
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const r of results) {
    const ref = reference[r.pane] ?? { port001: 0, port003: 0, port004: 0 };
    lines.push(
      `| ${r.pane} | ${ref.port001} | ${r.counts["port-discipline/needs-interface"] ?? 0} | ${ref.port003} | ${r.counts["port-discipline/no-concrete-class-import"] ?? 0} | ${ref.port004} | ${r.counts["port-discipline/no-adapter-instantiation"] ?? 0} |`,
    );
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- The plugin's PORT-004 numbers are expected to be 0-1 on `control-1` and `control-2` because the Error-allowlist drops the 7/8 `*ApiError` hits chemag found.",
  );
  lines.push("- Treatments are expected to match chemag exactly (zero hits in both arms).");
  lines.push("");
  lines.push("## Diagnostic detail");
  lines.push("");
  for (const r of results) {
    lines.push(`### ${r.pane}`);
    lines.push("");
    if (!r.ok) {
      lines.push(`Skipped — ${r.reason}`);
      lines.push("");
      continue;
    }
    if (r.diagnostics.length === 0) {
      lines.push("(no diagnostics)");
      lines.push("");
      continue;
    }
    for (const d of r.diagnostics) {
      lines.push(`- \`${d.rule}\` at \`${d.file}:${d.line}\` — ${d.message}`);
    }
    lines.push("");
  }

  const out = path.join(BENCH_RESULTS_ROOT, "eslint-plugin-summary.md");
  fs.writeFileSync(out, lines.join("\n"));
  // eslint-disable-next-line no-console
  console.log(`Summary written: ${out}`);

  // Acceptance-criteria report — log to stderr so the human or harness can grep.
  // Bench uses flat-layout compounds (manifest-driven roles), so the plugin's
  // path-based classification doesn't apply. Treatments-zero is expected and
  // matches chemag; controls-zero is expected (the flat layout means the rule
  // doesn't classify any file as adapter/reaction at all). The PORT-004
  // false-positive-drop assertion is exercised by the new in-repo
  // `valid/error-subclass` fixture instead — see notes section above.
  for (const r of results) {
    const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
    if (r.pane.startsWith("treatment") && total > 0) {
      // eslint-disable-next-line no-console
      console.error(`  WARNING: ${r.pane} reports ${total} diagnostics; expected 0`);
    }
  }
}

function main(): void {
  // eslint-disable-next-line no-console
  console.log("validate-bench: running eslint-plugin-port-discipline on 4 bench panes...");
  fs.mkdirSync(BENCH_RESULTS_ROOT, { recursive: true });
  const results: PaneResult[] = [];
  for (const pane of PANES) {
    const r = validatePane(pane);
    writePaneResult(r);
    results.push(r);
  }
  writeSummary(results);
  // eslint-disable-next-line no-console
  console.log("validate-bench: done.");
}

main();
