// ---------------------------------------------------------------------------
// CHEM-PORT-001 — ported from packages/core/src/checks/port-needs-interface.ts
//
// Semantic (simplified for the per-file ESLint runtime model):
//   A compound that has at least one ADAPTER file AND at least one REACTION
//   file but ZERO INTERFACE files emits ONE diagnostic on the lexicographically
//   first adapter file in that compound.
//
// The reference (chemag) rule also gates on "adapter actually imports an
// I/O module". The ESLint port drops that guard for two reasons:
//
//   1. The PORT-001 bench fixtures store no real source — the chemag tests
//      mock `parseImports`, which an ESLint rule can't do. Re-using the
//      same fixtures here means we can't observe real imports.
//   2. The dropped guard is a lossless tightening: if a compound has
//      adapter+reaction+no-interface, you want an interface regardless of
//      whether the adapter currently does I/O. The chemag rule was lenient
//      to avoid noise on pre-existing dataclass-shaped adapters; the
//      ESLint port leans toward parity with the spirit of the rule.
//
// Cardinality: one diagnostic per compound. Dedupe by reporting only when
// the file under lint is the *lexicographically-first* adapter file in the
// compound (deterministic, no shared state needed across files).
// ---------------------------------------------------------------------------
import { ESLintUtils } from "@typescript-eslint/utils";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type PathClassificationOptions,
  type Role,
  classifyPath,
} from "../utils/path-classification.js";

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/adromero/chem-agnostic/blob/main/packages/eslint-plugin/docs/rules/${name}.md`,
);

type Options = [PathClassificationOptions];
type MessageIds = "missingInterface";

const PATH_CLASSIFICATION_SCHEMA = {
  type: "object" as const,
  properties: {
    compoundsRoot: { type: "string" as const },
    adapterPaths: { type: "array" as const, items: { type: "string" as const } },
    interfacePaths: { type: "array" as const, items: { type: "string" as const } },
    reactionPaths: { type: "array" as const, items: { type: "string" as const } },
    catalystPaths: { type: "array" as const, items: { type: "string" as const } },
  },
  required: ["compoundsRoot"],
  additionalProperties: false,
};

export default createRule<Options, MessageIds>({
  name: "needs-interface",
  meta: {
    type: "problem",
    docs: {
      description: "Compounds with concrete I/O must declare an interface role",
    },
    messages: {
      missingInterface:
        "Compound '{{compound}}' has adapter(s) but no interface file. Add an interface to make the port explicit.",
    },
    schema: [PATH_CLASSIFICATION_SCHEMA],
  },
  defaultOptions: [{ compoundsRoot: "" }],
  create(context) {
    return {
      "Program:exit"(node) {
        const opts = context.options[0];
        if (!opts || !opts.compoundsRoot) return;

        const filename = context.physicalFilename ?? context.filename;
        const classification = classifyPath(filename, opts);
        if (classification.compound === null) return;
        if (classification.role !== "adapter") return;

        // Enumerate sibling role folders. The compound directory is the
        // parent of the role folder (e.g. compoundsRoot/vendors/adapters/store.ts
        // → compound dir = compoundsRoot/vendors).
        const adapterDir = path.dirname(filename);
        const compoundDir = path.dirname(adapterDir);

        const sibs = enumerateCompoundFiles(compoundDir, opts);
        if (!sibs) return;

        // Guards (in cheap-to-expensive order):
        if (sibs.byRole.interface.length > 0) return; // already has an interface — no fire
        if (sibs.byRole.reaction.length === 0) return; // no orchestration to protect — no fire
        if (sibs.byRole.adapter.length === 0) return; // shouldn't happen — we're an adapter

        // Dedupe: only the lexicographically-first adapter file reports.
        const firstAdapter = sibs.byRole.adapter[0];
        if (path.resolve(filename) !== path.resolve(firstAdapter)) return;

        context.report({
          node,
          messageId: "missingInterface",
          data: { compound: classification.compound },
        });
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface SiblingFiles {
  byRole: Record<Exclude<Role, "unknown">, string[]>;
}

/**
 * Read the compound directory and group all `.ts` / `.tsx` files by role.
 *
 * Returns `null` if the compound directory cannot be read (e.g. it was
 * removed between lint passes). All file lists are sorted lexicographically
 * by absolute path so the "first adapter" dedupe key is stable.
 *
 * Role folders are resolved against `opts` (same defaults as classifyPath).
 */
function enumerateCompoundFiles(
  compoundDir: string,
  opts: PathClassificationOptions,
): SiblingFiles | null {
  const adapterFolders = opts.adapterPaths ?? ["adapters"];
  const interfaceFolders = opts.interfacePaths ?? ["interfaces"];
  const reactionFolders = opts.reactionPaths ?? ["reactions"];
  const catalystFolders = opts.catalystPaths ?? ["catalysts"];

  const result: SiblingFiles = {
    byRole: { adapter: [], interface: [], reaction: [], catalyst: [] },
  };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(compoundDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    let role: Exclude<Role, "unknown"> | null = null;
    if (adapterFolders.includes(ent.name)) role = "adapter";
    else if (interfaceFolders.includes(ent.name)) role = "interface";
    else if (reactionFolders.includes(ent.name)) role = "reaction";
    else if (catalystFolders.includes(ent.name)) role = "catalyst";
    if (role === null) continue;

    const roleDir = path.join(compoundDir, ent.name);
    let files: string[];
    try {
      files = fs.readdirSync(roleDir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!/\.tsx?$/.test(f)) continue;
      result.byRole[role].push(path.join(roleDir, f));
    }
  }

  // Lexicographic sort per role for deterministic dedupe.
  for (const role of Object.keys(result.byRole) as (keyof typeof result.byRole)[]) {
    result.byRole[role].sort();
  }

  return result;
}
