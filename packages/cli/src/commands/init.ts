import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { stringify } from "yaml";
import { loadPlugin } from "../plugin-loader.js";
import { generateClaudeMd } from "@chemag/core/template-claude-md";
import { tr } from "@chemag/core/vocabulary";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const YLW = "\x1b[33m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

function defaultRolesAndBonds() {
  return {
    roles: {
      element: { description: "Immutable value object", folder: "elements" },
      molecule: {
        description: "Domain state composed of elements",
        folder: "molecules",
      },
      reaction: { description: "Workflow or use case", folder: "reactions" },
      interface: { description: "Contract / port", folder: "interfaces" },
      adapter: {
        description: "Concrete implementation of an interface",
        folder: "adapters",
      },
      buffer: { description: "Middleware wrapper", folder: "buffers" },
    },

    bonds: {
      element: ["element"],
      molecule: ["element", "molecule"],
      reaction: ["element", "molecule", "interface"],
      interface: ["element", "molecule"],
      adapter: ["element", "molecule", "interface", "adapter"],
      buffer: ["element", "molecule", "interface"],
    },

    compound_types: {
      compound: {
        description: "Standard feature compound",
        importable_by: "all",
        can_import: ["compound", "reagent"],
      },
      reagent: {
        description: "Shared domain building blocks",
        importable_by: "all",
        can_import: ["reagent"],
      },
      solvent: {
        description: "Cross-cutting infrastructure",
        importable_by: "all",
        can_import: ["reagent"],
        implicit: true,
      },
      catalyst: {
        description: "Composition root",
        importable_by: "none",
        can_import: ["compound", "reagent", "solvent"],
        singleton: true,
        allowed_roles: ["adapter"],
      },
    },
  };
}

function buildDefaultWorkspace(name: string, language: string, publicSurface: string) {
  const base = defaultRolesAndBonds();
  return {
    workspace: name,
    language,
    ...base,
    paths: {
      compounds: "./src/compounds",
      reagents: "./src/reagents",
      solvents: "./src/solvents",
      catalyst: "./src/catalyst",
    },

    rules: {
      cross_compound_imports: "public_only",
      role_from_path: true,
      public_surface: publicSurface,
      manifest_filename: "compound.yaml",
    },
  };
}

interface MultiLanguageEntry {
  id: string;
  language: string;
  publicSurface: string;
}

/**
 * Build a multi-language workspace object. The emitted YAML uses `languages:`
 * as input authority. We deliberately omit the legacy top-level `language`
 * and `paths` fields — the loader derives them at parse time from
 * `languages[0]`. The `rules` block keeps only workspace-wide settings;
 * per-sub-tree `public_surface` lives inside each `languages` entry.
 */
function buildMultiLanguageWorkspace(name: string, entries: MultiLanguageEntry[]) {
  const base = defaultRolesAndBonds();
  return {
    workspace: name,
    ...base,
    languages: entries.map((e) => ({
      id: e.id,
      language: e.language,
      paths: {
        compounds: `./apps/${e.id}/src/compounds`,
        reagents: `./apps/${e.id}/src/reagents`,
        solvents: `./apps/${e.id}/src/solvents`,
        catalyst: `./apps/${e.id}/src/catalyst`,
      },
      public_surface: e.publicSurface,
    })),

    rules: {
      cross_compound_imports: "public_only",
      role_from_path: true,
      manifest_filename: "compound.yaml",
    },
  };
}

/**
 * Assign sub-tree ids deterministically: when each language appears once,
 * the id is the language name. When a language appears multiple times, ids
 * become "<language>-1", "<language>-2", ... in the order supplied.
 */
function assignSubtreeIds(languages: string[]): { id: string; language: string }[] {
  const counts = new Map<string, number>();
  for (const lang of languages) counts.set(lang, (counts.get(lang) ?? 0) + 1);

  const indexes = new Map<string, number>();
  return languages.map((lang) => {
    const total = counts.get(lang) ?? 0;
    if (total === 1) return { id: lang, language: lang };
    const next = (indexes.get(lang) ?? 0) + 1;
    indexes.set(lang, next);
    return { id: `${lang}-${next}`, language: lang };
  });
}

/**
 * Collect all `--language <value>` occurrences in argv. Repeatable;
 * preserves the order in which they appear so sub-tree id assignment
 * (and "primary language" derivation) is deterministic.
 */
function collectLanguages(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--language" && argv[i + 1]) {
      out.push(argv[i + 1]);
      i++;
    }
  }
  return out;
}

/**
 * True if the existing .gitignore content already excludes `.chemag/cache/`.
 * Matches the exact entry plus the broader `.chemag/` form (with or without
 * trailing slash) so we don't add duplicate lines on re-runs.
 */
function gitignoreCovers(content: string, entry: string): boolean {
  const trimmedEntry = entry.replace(/\/+$/, "");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const stripped = line.replace(/\/+$/, "");
    if (stripped === trimmedEntry) return true;
    if (stripped === ".chemag") return true;
  }
  return false;
}

export function checkPython3Available(): boolean {
  try {
    execSync("python3 --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function checkGoAvailable(): boolean {
  try {
    execSync("go version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function cmdInit(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`\n${BLD}${tr("cli.command.init")}${R}\n`);
    console.log(
      `${BLD}Options:${R}\n  --path <dir>          Base directory (default: current directory)\n  --language <lang>     Language: typescript (default), python, or go. May be repeated to scaffold a multi-language workspace.\n\nCreates workspace.yaml with the default roles and dependency rules,\nplus the directory structure for modules, shared kernels,\ninfrastructure, and the composition root.\n`,
    );
    process.exit(0);
  }

  const name = argv.find((a) => !a.startsWith("-"));
  if (!name) {
    console.error(`${RED}Workspace name required.${R} Usage: chem init <name>`);
    process.exit(2);
  }

  const pathIdx = argv.indexOf("--path");
  const baseDir =
    pathIdx >= 0 && argv[pathIdx + 1] ? path.resolve(argv[pathIdx + 1]) : process.cwd();

  const languages = collectLanguages(argv);

  const wsPath = path.join(baseDir, "workspace.yaml");

  if (fs.existsSync(wsPath)) {
    console.error(`${RED}workspace.yaml already exists in ${baseDir}${R}`);
    process.exit(1);
  }

  if (languages.length >= 2) {
    runMultiLanguageInit(name, baseDir, wsPath, languages);
    return;
  }

  // Legacy single-language flow (0 or 1 --language arguments).
  const language = languages[0] ?? "typescript";

  // Load the plugin for this language (validates the language value)
  const plugin = loadPlugin({ language });

  // Print language info when using default
  if (languages.length === 0) {
    console.log(`${DIM}Using TypeScript. Pass --language python for Python projects.${R}`);
  }

  // For Python, check python3 availability
  if (language === "python" && !checkPython3Available()) {
    console.warn(
      `${YLW}Python 3.10+ not found. You will need it for \`chem-ag analyze\` and \`chem-ag scaffold\`.${R}`,
    );
  }

  // For Go, warn if the toolchain is missing — chemag itself doesn't need
  // it (the bundled helper binary handles AST parsing) but the user does
  // to compile their workspace code.
  if (language === "go" && !checkGoAvailable()) {
    console.warn(
      `${YLW}Go toolchain not found. You will need it to build Go workspace code (\`go build ./...\`).${R}`,
    );
  }

  const ws = buildDefaultWorkspace(name, language, plugin.defaults.publicSurface);
  const yamlContent = stringify(ws, { lineWidth: 100 });

  console.log(`\n${BLD}chem init${R}\n`);

  // Write workspace.yaml
  fs.writeFileSync(wsPath, yamlContent, "utf-8");
  console.log(`  ${GRN}+${R}  workspace.yaml`);

  // Write CLAUDE.md
  const claudeMdPath = path.join(baseDir, "CLAUDE.md");
  fs.writeFileSync(claudeMdPath, generateClaudeMd(name, plugin), "utf-8");
  console.log(`  ${GRN}+${R}  CLAUDE.md`);

  // Create directories
  const dirs = [ws.paths.compounds, ws.paths.reagents, ws.paths.solvents, ws.paths.catalyst];

  for (const dir of dirs) {
    const abs = path.resolve(baseDir, dir);
    fs.mkdirSync(abs, { recursive: true });
    const rel = path.relative(baseDir, abs);
    console.log(`  ${GRN}+${R}  ${rel}/`);
  }

  // Scaffold a minimal go.mod so the workspace is buildable out of the box.
  if (language === "go") {
    writeGoModIfMissing(baseDir, name);
  }

  writeGitignore(baseDir);

  console.log();
  console.log(`${GRN}${BLD}Workspace "${name}" initialized${R}`);
  console.log(`${DIM}Next: chem add compound <name> to create your first feature${R}\n`);
}

/**
 * Multi-language init flow. Emits a `languages:` block in workspace.yaml and
 * scaffolds per-sub-tree directory trees under ./apps/<id>/src/...
 * CLAUDE.md continues to use the FIRST sub-tree's plugin for the
 * language-specific section — multi-language CLAUDE.md richness is WP-020/WP-021.
 */
function runMultiLanguageInit(
  name: string,
  baseDir: string,
  wsPath: string,
  languages: string[],
): void {
  // Validate every requested language by loading its plugin. This also gives
  // us per-language defaults (publicSurface) for the sub-tree entries.
  const idAssignments = assignSubtreeIds(languages);
  const entries: MultiLanguageEntry[] = idAssignments.map(({ id, language }) => {
    const plugin = loadPlugin({ language });
    return { id, language, publicSurface: plugin.defaults.publicSurface };
  });

  // Python presence warning (parallel to the legacy flow).
  if (entries.some((e) => e.language === "python") && !checkPython3Available()) {
    console.warn(
      `${YLW}Python 3.10+ not found. You will need it for \`chem-ag analyze\` and \`chem-ag scaffold\`.${R}`,
    );
  }

  // Go presence warning (parallel to Python). chemag bundles its own Go
  // helper binary; the user still needs `go` to compile their workspace.
  if (entries.some((e) => e.language === "go") && !checkGoAvailable()) {
    console.warn(
      `${YLW}Go toolchain not found. You will need it to build Go workspace code (\`go build ./...\`).${R}`,
    );
  }

  const ws = buildMultiLanguageWorkspace(name, entries);
  const yamlContent = stringify(ws, { lineWidth: 100 });

  console.log(
    `\n${BLD}chem init${R} ${DIM}(multi-language: ${entries.map((e) => e.id).join(", ")})${R}\n`,
  );

  fs.writeFileSync(wsPath, yamlContent, "utf-8");
  console.log(`  ${GRN}+${R}  workspace.yaml`);

  // CLAUDE.md uses the primary (first) sub-tree's plugin for the language section.
  const primaryPlugin = loadPlugin({ language: entries[0].language });
  const claudeMdPath = path.join(baseDir, "CLAUDE.md");
  fs.writeFileSync(claudeMdPath, generateClaudeMd(name, primaryPlugin), "utf-8");
  console.log(`  ${GRN}+${R}  CLAUDE.md`);

  // Scaffold per-sub-tree directories.
  for (const entry of entries) {
    const subDirs = [
      `./apps/${entry.id}/src/compounds`,
      `./apps/${entry.id}/src/reagents`,
      `./apps/${entry.id}/src/solvents`,
      `./apps/${entry.id}/src/catalyst`,
    ];
    for (const dir of subDirs) {
      const abs = path.resolve(baseDir, dir);
      fs.mkdirSync(abs, { recursive: true });
      const rel = path.relative(baseDir, abs);
      console.log(`  ${GRN}+${R}  ${rel}/`);
    }
  }

  // Scaffold a minimal go.mod for every Go sub-tree so each one is
  // buildable out of the box.
  for (const entry of entries) {
    if (entry.language !== "go") continue;
    writeGoModIfMissing(path.join(baseDir, "apps", entry.id), entry.id);
  }

  writeGitignore(baseDir);

  console.log();
  console.log(`${GRN}${BLD}Workspace "${name}" initialized${R}`);
  console.log(
    `${DIM}Next: chem add compound <name> --workspace apps/${entries[0].id}/workspace.yaml${R}\n`,
  );
}

/**
 * Write a skeleton `go.mod` at the given directory if one does not
 * already exist. The module path is derived from `name` (lowercased) so
 * `chemag init --language go demo` produces `module demo` — enough to
 * make `go build ./...` succeed once units are scaffolded.
 */
function writeGoModIfMissing(dir: string, name: string): void {
  const target = path.join(dir, "go.mod");
  if (fs.existsSync(target)) return;
  fs.mkdirSync(dir, { recursive: true });
  const modulePath = name.toLowerCase().replace(/[^a-z0-9._\-/]+/g, "-");
  fs.writeFileSync(target, `module ${modulePath}\n\ngo 1.22\n`, "utf-8");
  const rel = path.relative(process.cwd(), target);
  console.log(`  ${GRN}+${R}  ${rel || "go.mod"}`);
}

/**
 * Ensure .gitignore exists and excludes the cache directory. Idempotent:
 * if a .gitignore is already present we append the entry only when it
 * isn't already listed (matching either ".chemag/cache/" or
 * ".chemag/cache" or the parent ".chemag/" wildcards).
 */
function writeGitignore(baseDir: string): void {
  const gitignorePath = path.join(baseDir, ".gitignore");
  const cacheEntry = ".chemag/cache/";
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, "utf-8");
    if (!gitignoreCovers(existing, cacheEntry)) {
      const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
      fs.writeFileSync(gitignorePath, `${existing}${sep}${cacheEntry}\n`, "utf-8");
      console.log(`  ${GRN}~${R}  .gitignore (added ${cacheEntry})`);
    }
  } else {
    fs.writeFileSync(gitignorePath, `${cacheEntry}\n`, "utf-8");
    console.log(`  ${GRN}+${R}  .gitignore`);
  }
}
