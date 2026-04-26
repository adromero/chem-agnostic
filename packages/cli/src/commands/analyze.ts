import * as path from "node:path";
import { readFileSync } from "node:fs";
import { discoverCompounds, loadCompound, loadWorkspace } from "@chemag/core/loader";
import { checkImports } from "@chemag/core/import-check";
import type { LanguagePlugin } from "@chemag/core/plugin-interface";
import type { LoadedCompound, ParsedImport, Workspace } from "@chemag/core/types";
import { applyWorkspaceVocabulary, tr } from "@chemag/core/vocabulary";
import { contentHash } from "../cache/content-hash.js";
import { createImportCache } from "../cache/import-cache.js";
import { createManifestCache } from "../cache/manifest-cache.js";
import { loadPlugin } from "../plugin-loader.js";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const YEL = "\x1b[33m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

export function cmdAnalyze(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`\n${BLD}${tr("cli.command.analyze")}${R}\n`);
    console.log(`${BLD}Options:${R}\n  --json   Machine-readable output\n`);
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
  const manifestCache = createManifestCache(wsDir);
  const importCache = createImportCache(wsDir);

  let ws: Workspace;
  try {
    const raw = readFileSync(wsPath, "utf-8");
    const hash = contentHash(raw);
    const cached = manifestCache.getWorkspace(wsPath, hash);
    if (cached !== null) {
      ws = cached;
    } else {
      ws = loadWorkspace(wsPath);
      manifestCache.setWorkspace(wsPath, ws, hash);
    }
  } catch (e: unknown) {
    console.error(`${RED}Failed to load workspace:${R} ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  // Phase 2 — adopt workspace.vocabulary if Phase 1 (cli.ts) didn't already
  // settle on a stronger source. Must run before any tr() output below.
  applyWorkspaceVocabulary(ws);

  let compounds: LoadedCompound[];
  try {
    compounds = discoverCompounds(ws, wsDir, {
      loadCompound: (manifestPath: string): LoadedCompound => {
        const raw = readFileSync(manifestPath, "utf-8");
        const hash = contentHash(raw);
        const cached = manifestCache.getCompound(manifestPath, hash);
        if (cached !== null) return cached;
        const parsed = loadCompound(manifestPath);
        manifestCache.setCompound(manifestPath, parsed, hash);
        return parsed;
      },
    });
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

  const diags = checkImports(ws, compounds, plugin, {
    parseImportsBatch: (filePaths: string[], p: LanguagePlugin) => {
      const result = new Map<string, ParsedImport[]>();
      const misses: { abs: string; hash: string }[] = [];

      for (const abs of filePaths) {
        let raw: string;
        try {
          raw = readFileSync(abs, "utf-8");
        } catch {
          // Source file unreadable — let the plugin try (it may fail gracefully).
          continue;
        }
        const hash = contentHash(raw);
        const cached = importCache.get(abs, hash);
        if (cached !== null) {
          result.set(abs, cached);
        } else {
          misses.push({ abs, hash });
        }
      }

      if (misses.length > 0) {
        const parsedMisses = p.parseImportsBatch(misses.map((m) => m.abs));
        for (const { abs, hash } of misses) {
          const parsed = parsedMisses.get(abs) ?? [];
          importCache.set(abs, parsed, hash);
          result.set(abs, parsed);
        }
      }

      return result;
    },
  });

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
