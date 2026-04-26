import * as path from "node:path";
import { loadWorkspace, discoverCompounds } from "@chemag/core/loader";
import { loadPlugin } from "../plugin-loader.js";
import { allChecks } from "@chemag/core/checks";
import type { Diagnostic, CheckOptions } from "@chemag/core/types";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const YEL = "\x1b[33m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

export function cmdCheck(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`
${BLD}chemtest check${R} — validate workspace manifests and filesystem

${BLD}Usage:${R}  chemtest check <workspace.yaml> [options]

${BLD}Options:${R}
  --manifest-only   Skip filesystem checks
  --verbose, -v     Show warning details
  --json            Machine-readable output
`);
    process.exit(0);
  }

  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const json = argv.includes("--json");
  const manifestOnly = argv.includes("--manifest-only");
  const wsArg = argv.find((a) => !a.startsWith("-"));

  if (!wsArg) {
    console.error(`${RED}No workspace file specified.${R}`);
    process.exit(2);
  }

  const wsPath = path.resolve(wsArg);
  const wsDir = path.dirname(wsPath);

  let ws;
  try {
    ws = loadWorkspace(wsPath);
  } catch (e: unknown) {
    console.error(`${RED}Failed to load workspace:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  let compounds;
  try {
    compounds = discoverCompounds(ws, wsDir);
  } catch (e: unknown) {
    console.error(`${RED}Failed to discover compounds:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  // Load the language plugin to get default public surface filename
  const plugin = loadPlugin({ language: ws.language });

  // Stats
  const byType: Record<string, number> = {};
  for (const c of compounds) {
    const t = c.manifest.type ?? "compound";
    byType[t] = (byType[t] ?? 0) + 1;
  }
  const totalUnits = compounds.reduce((n, c) => n + (c.manifest.units?.length ?? 0), 0);
  const totalAssays = compounds.reduce((n, c) => n + (c.manifest.assays?.length ?? 0), 0);

  if (!json) {
    console.log(`\n${BLD}chemtest check${R}\n`);
    console.log(`${BLD}Workspace:${R} ${ws.workspace}`);
    const parts = Object.entries(byType).map(([t, n]) => `${t}: ${n}`);
    console.log(`${DIM}  ${parts.join(" | ")}${R}`);
    console.log(`${DIM}  Units: ${totalUnits} | Assays: ${totalAssays}${R}`);
    if (manifestOnly) console.log(`${DIM}  Mode: manifest-only${R}`);
    console.log();
  }

  // Run checks with plugin's default public surface
  const opts: CheckOptions = {
    manifestOnly,
    defaultPublicSurface: plugin.defaults.publicSurface,
  };
  let totalErrors = 0;
  let totalWarnings = 0;
  let passed = 0;
  let failed = 0;
  const results: { check: string; diagnostics: Diagnostic[] }[] = [];

  for (const { name, fn } of allChecks) {
    const diags = fn(ws, compounds, opts);
    results.push({ check: name, diagnostics: diags });

    const errors = diags.filter((d) => d.level === "error");
    const warnings = diags.filter((d) => d.level === "warning");
    totalErrors += errors.length;
    totalWarnings += warnings.length;

    if (errors.length > 0) {
      failed++;
    } else {
      passed++;
    }

    if (!json) {
      if (errors.length > 0) {
        const ws = warnings.length ? `, ${warnings.length} warning(s)` : "";
        console.log(`  ${RED}\u2717${R}  ${name} ${DIM}\u2014 ${errors.length} error(s)${ws}${R}`);
        for (const d of diags) {
          const color = d.level === "error" ? RED : YEL;
          const pfx = d.compound ? `${DIM}${d.compound}${R} > ` : "";
          console.log(`     ${color}${d.level}${R}: ${pfx}${d.message}`);
          if (d.hint) console.log(`     ${DIM}${d.hint}${R}`);
        }
        console.log();
      } else if (warnings.length > 0) {
        console.log(`  ${YEL}~${R}  ${name} ${DIM}\u2014 ${warnings.length} warning(s)${R}`);
        if (verbose) {
          for (const d of warnings) {
            const pfx = d.compound ? `${DIM}${d.compound}${R} > ` : "";
            console.log(`     ${YEL}warn${R}: ${pfx}${d.message}`);
            if (d.hint) console.log(`     ${DIM}${d.hint}${R}`);
          }
          console.log();
        }
      } else {
        console.log(`  ${GRN}\u2713${R}  ${name}`);
      }
    }
  }

  // Summary
  if (json) {
    console.log(
      JSON.stringify(
        {
          workspace: ws.workspace,
          compounds: compounds.length,
          units: totalUnits,
          assays: totalAssays,
          errors: totalErrors,
          warnings: totalWarnings,
          checks: results.map(({ check, diagnostics }) => ({
            check,
            passed: diagnostics.filter((d) => d.level === "error").length === 0,
            diagnostics,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log();
    if (totalErrors === 0) {
      const w = totalWarnings
        ? ` ${YEL}(${totalWarnings} warning${totalWarnings !== 1 ? "s" : ""})${R}`
        : "";
      console.log(`${GRN}${BLD}All ${passed} checks passed${R}${w}\n`);
    } else {
      const w = totalWarnings ? `, ${totalWarnings} warning${totalWarnings !== 1 ? "s" : ""}` : "";
      console.log(
        `${RED}${BLD}${failed} check${failed !== 1 ? "s" : ""} failed${R} \u2014 ${totalErrors} error${totalErrors !== 1 ? "s" : ""}${w} | ${GRN}${passed} passed${R}\n`,
      );
    }
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}
