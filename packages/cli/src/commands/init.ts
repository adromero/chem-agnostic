import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { stringify } from "yaml";
import { loadPlugin } from "../plugin-loader.js";
import { generateClaudeMd } from "@chemag/core/template-claude-md";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const YLW = "\x1b[33m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

function buildDefaultWorkspace(name: string, language: string, publicSurface: string) {
  return {
    workspace: name,
    language,

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

export function checkPython3Available(): boolean {
  try {
    execSync("python3 --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function cmdInit(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`
${BLD}chem init${R} — bootstrap a new Chem workspace

${BLD}Usage:${R}  chem init <name> [options]

${BLD}Options:${R}
  --path <dir>          Base directory (default: current directory)
  --language <lang>     Language: typescript (default) or python

Creates workspace.yaml with standard roles, bonds, and compound types,
plus the directory structure for compounds, reagents, solvents, and catalyst.
`);
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

  const langIdx = argv.indexOf("--language");
  const language = langIdx >= 0 && argv[langIdx + 1] ? argv[langIdx + 1] : "typescript";

  const wsPath = path.join(baseDir, "workspace.yaml");

  if (fs.existsSync(wsPath)) {
    console.error(`${RED}workspace.yaml already exists in ${baseDir}${R}`);
    process.exit(1);
  }

  // Load the plugin for this language (validates the language value)
  const plugin = loadPlugin({ language });

  // Print language info when using default
  if (langIdx < 0) {
    console.log(`${DIM}Using TypeScript. Pass --language python for Python projects.${R}`);
  }

  // For Python, check python3 availability
  if (language === "python" && !checkPython3Available()) {
    console.warn(
      `${YLW}Python 3.10+ not found. You will need it for \`chem-ag analyze\` and \`chem-ag scaffold\`.${R}`,
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

  console.log();
  console.log(`${GRN}${BLD}Workspace "${name}" initialized${R}`);
  console.log(`${DIM}Next: chem add compound <name> to create your first feature${R}\n`);
}
