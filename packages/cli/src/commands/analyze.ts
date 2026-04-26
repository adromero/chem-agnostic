import * as path from "node:path";
import { discoverCompounds, loadWorkspace } from "@chemag/core/loader";
import { checkImports } from "@chemag/core/import-check";
import type { LoadedCompound, Workspace } from "@chemag/core/types";
import { loadPlugin } from "../plugin-loader.js";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const YEL = "\x1b[33m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

export function cmdAnalyze(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`
${BLD}chemtest analyze${R} — check source imports against bond rules

${BLD}Usage:${R}  chemtest analyze <workspace.yaml> [options]

${BLD}Options:${R}
  --json   Machine-readable output

Analyzes actual import statements in source files and checks:
  - Bond rules (role-level dependency constraints)
  - Cross-compound imports go through public surface
  - No undeclared cross-compound imports
`);
    process.exit(0);
  }

  const json = argv.includes("--json");
  const wsArg = argv.find((a) => !a.startsWith("-"));

  if (!wsArg) {
    console.error(`${RED}No workspace file specified.${R}`);
    process.exit(2);
  }

  const wsPath = path.resolve(wsArg);
  const wsDir = path.dirname(wsPath);

  let ws: Workspace;
  try {
    ws = loadWorkspace(wsPath);
  } catch (e: unknown) {
    console.error(`${RED}Failed to load workspace:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  let compounds: LoadedCompound[];
  try {
    compounds = discoverCompounds(ws, wsDir);
  } catch (e: unknown) {
    console.error(`${RED}Failed to discover compounds:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  const plugin = loadPlugin({ language: ws.language });

  const totalFiles = compounds.reduce((n, c) => n + (c.manifest.units?.length ?? 0), 0);

  if (!json) {
    console.log(`\n${BLD}chemtest analyze${R}\n`);
    console.log(`${BLD}Workspace:${R} ${ws.workspace}`);
    console.log(`${DIM}  Scanning ${totalFiles} source files (${plugin.name})${R}\n`);
  }

  const diags = checkImports(ws, compounds, plugin);

  const errors = diags.filter((d) => d.level === "error");
  const warnings = diags.filter((d) => d.level === "warning");

  if (json) {
    console.log(
      JSON.stringify(
        {
          errors: errors.length,
          warnings: warnings.length,
          diagnostics: diags,
        },
        null,
        2,
      ),
    );
  } else {
    // Group by check
    const byCheck = new Map<string, typeof diags>();
    for (const d of diags) {
      if (!byCheck.has(d.check)) byCheck.set(d.check, []);
      byCheck.get(d.check)!.push(d);
    }

    const checkNames = ["import-bonds", "import-bypass", "import-undeclared"];

    for (const name of checkNames) {
      const group = byCheck.get(name) ?? [];
      const errs = group.filter((d) => d.level === "error");

      if (errs.length > 0) {
        console.log(`  ${RED}✗${R}  ${name} ${DIM}— ${errs.length} violation(s)${R}`);
        for (const d of errs) {
          const pfx = d.compound ? `${DIM}${d.compound}${R} > ` : "";
          console.log(`     ${RED}error${R}: ${pfx}${d.message}`);
          if (d.hint) console.log(`     ${DIM}${d.hint}${R}`);
        }
        console.log();
      } else {
        console.log(`  ${GRN}✓${R}  ${name}`);
      }
    }

    console.log();
    if (errors.length === 0) {
      const w = warnings.length
        ? ` ${YEL}(${warnings.length} warning${warnings.length !== 1 ? "s" : ""})${R}`
        : "";
      console.log(`${GRN}${BLD}All imports valid${R}${w}\n`);
    } else {
      console.log(
        `${RED}${BLD}${errors.length} import violation${errors.length !== 1 ? "s" : ""} found${R}\n`,
      );
    }
  }

  process.exit(errors.length > 0 ? 1 : 0);
}
