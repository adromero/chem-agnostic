#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Generate the diagnostics-index markdown from DIAGNOSTIC_CODES.
//
// Today the file lands at `docs/cli-reference/diagnostics.md` because the
// docs site (`apps/docs-site/`) does not yet exist in the workspace. WP-053
// will move the file to `apps/docs-site/src/content/docs/cli-reference/`.
// Re-run with: pnpm gen:diagnostics
// ---------------------------------------------------------------------------
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIAGNOSTIC_CODES,
  type DiagnosticCategory,
  type DiagnosticCodeMeta,
} from "../packages/core/src/diagnostics/codes.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const docsSitePath = resolve(
  repoRoot,
  "apps/docs-site/src/content/docs/cli-reference/diagnostics.md",
);
const fallbackPath = resolve(repoRoot, "docs/cli-reference/diagnostics.md");

const useDocsSite = existsSync(resolve(repoRoot, "apps/docs-site"));
const target = useDocsSite ? docsSitePath : fallbackPath;

const banner = useDocsSite
  ? null
  : "> **NOTE:** Generated index — will be migrated to `apps/docs-site/src/content/docs/cli-reference/diagnostics.md` in WP-053. Do not hand-edit; regenerate via `npm run gen:diagnostics`.";

const CATEGORY_ORDER: DiagnosticCategory[] = [
  "MANIFEST",
  "ROLE",
  "PLACEMENT",
  "PUBLIC",
  "EXPORT",
  "IMPORT",
  "TYPE",
  "BOND",
  "SIGNAL",
  "WIRING",
  "ASSAY",
];

function byCategory(): Map<DiagnosticCategory, DiagnosticCodeMeta[]> {
  const out = new Map<DiagnosticCategory, DiagnosticCodeMeta[]>();
  for (const cat of CATEGORY_ORDER) out.set(cat, []);
  for (const meta of Object.values(DIAGNOSTIC_CODES)) {
    if (!out.has(meta.category)) out.set(meta.category, []);
    out.get(meta.category)!.push(meta);
  }
  for (const list of out.values()) list.sort((a, b) => a.code.localeCompare(b.code));
  return out;
}

function render(): string {
  const lines: string[] = [];
  lines.push("# Diagnostic codes");
  lines.push("");
  if (banner) {
    lines.push(banner);
    lines.push("");
  }
  lines.push(
    "Every diagnostic emitted by `chemag check` and `chemag analyze` carries a stable `CHEM-CATEGORY-NNN` code. Codes are bijective with the `diagnostic.*` TrKey set in `packages/core/src/vocabulary/keys.ts`. Run `chemag check --explain CHEM-XXX-NNN` to read the entry from the terminal.",
  );
  lines.push("");

  // Summary table
  lines.push("## Summary");
  lines.push("");
  lines.push("| Code | Category | Level | TrKey |");
  lines.push("|---|---|---|---|");
  const all = Object.values(DIAGNOSTIC_CODES)
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code));
  for (const m of all) {
    lines.push(
      `| [\`${m.code}\`](#${m.helpFragment}) | ${m.category} | ${m.level} | \`${m.trKey}\` |`,
    );
  }
  lines.push("");

  // Per-category sections
  for (const [cat, entries] of byCategory()) {
    if (entries.length === 0) continue;
    lines.push(`## ${cat}`);
    lines.push("");
    for (const m of entries) {
      lines.push(`### ${m.code} { #${m.helpFragment} }`);
      lines.push("");
      lines.push(`- **Category:** ${m.category}`);
      lines.push(`- **Level:** ${m.level}`);
      lines.push(`- **TrKey:** \`${m.trKey}\``);
      if (m.deprecated) {
        const repl = m.deprecated.replacement
          ? ` (replaced by \`${m.deprecated.replacement}\`)`
          : "";
        lines.push(`- **Status:** deprecated since ${m.deprecated.since}${repl}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function main(): void {
  const out = render();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, out, "utf-8");
  // eslint-disable-next-line no-console
  console.log(`Wrote ${target} (${Object.keys(DIAGNOSTIC_CODES).length} codes)`);
}

main();
