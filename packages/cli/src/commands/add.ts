import * as fs from "node:fs";
import * as path from "node:path";
import { parseDocument, stringify } from "yaml";
import { loadWorkspace, discoverCompounds } from "@chemag/core/loader";
import { loadPlugin } from "../plugin-loader.js";
import { scaffoldWorkspace } from "@chemag/core/scaffold";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

export function cmdAdd(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help") || argv.length < 2) {
    console.log(`
${BLD}chem add${R} — add a compound or unit

${BLD}Usage:${R}
  chem add compound <name> [options]
  chem add unit <compound> <role> <name> [options]

${BLD}Compound options:${R}
  --type <type>      compound (default), reagent, or solvent
  --workspace <file> Path to workspace.yaml (default: ./workspace.yaml)

${BLD}Unit options:${R}
  --workspace <file>  Path to workspace.yaml (default: ./workspace.yaml)
  --export            Also add to the compound's exports
  --implements <name> Interface this adapter implements (adapter role only)

${BLD}Examples:${R}
  ${DIM}chem add compound payments${R}
  ${DIM}chem add compound identity --type reagent${R}
  ${DIM}chem add unit reporting element InvoiceId${R}
  ${DIM}chem add unit reporting adapter PgReportRepo --implements ReportRepository --export${R}
`);
    process.exit(0);
  }

  const sub = argv[0];

  if (sub === "compound") {
    addCompound(argv.slice(1));
  } else if (sub === "unit") {
    addUnit(argv.slice(1));
  } else {
    console.error(`${RED}Unknown add target: "${sub}". Use "compound" or "unit".${R}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// chem add compound
// ---------------------------------------------------------------------------

function addCompound(argv: string[]): void {
  const name = argv.find((a) => !a.startsWith("-"));
  if (!name) {
    console.error(`${RED}Compound name required.${R}`);
    process.exit(2);
  }

  const wsPath = resolveWorkspace(argv);
  const ws = loadWorkspace(wsPath);
  const wsDir = path.dirname(wsPath);

  const typeIdx = argv.indexOf("--type");
  const type = typeIdx >= 0 ? argv[typeIdx + 1] : "compound";

  // Determine directory
  let baseDir: string;
  switch (type) {
    case "reagent":
      baseDir = path.resolve(wsDir, ws.paths.reagents ?? "./src/reagents");
      break;
    case "solvent":
      baseDir = path.resolve(wsDir, ws.paths.solvents ?? "./src/solvents");
      break;
    default:
      baseDir = path.resolve(wsDir, ws.paths.compounds);
      break;
  }

  const compoundDir = path.join(baseDir, name);
  const manifestFile = ws.rules?.manifest_filename ?? "compound.yaml";
  const manifestPath = path.join(compoundDir, manifestFile);

  if (fs.existsSync(manifestPath)) {
    console.error(`${RED}Compound "${name}" already exists at ${compoundDir}${R}`);
    process.exit(1);
  }

  console.log(`\n${BLD}chem add compound${R}\n`);

  // Create directory
  fs.mkdirSync(compoundDir, { recursive: true });
  console.log(`  ${GRN}+${R}  ${path.relative(wsDir, compoundDir)}/`);

  // Write compound.yaml
  const manifest: Record<string, unknown> = {
    compound: name,
  };
  if (type !== "compound") manifest.type = type;
  manifest.description = "";
  manifest.exports = {};
  manifest.imports = [];
  manifest.units = [];
  manifest.assays = [];

  fs.writeFileSync(manifestPath, stringify(manifest, { lineWidth: 100 }), "utf-8");
  console.log(`  ${GRN}+${R}  ${path.relative(wsDir, manifestPath)}`);

  console.log();
  console.log(`${GRN}${BLD}Compound "${name}" created${R}`);
  console.log(`${DIM}Next: chem add unit ${name} <role> <Name>${R}\n`);
}

// ---------------------------------------------------------------------------
// chem add unit
// ---------------------------------------------------------------------------

function addUnit(argv: string[]): void {
  const positional = argv.filter((a) => !a.startsWith("-"));
  if (positional.length < 3) {
    console.error(`${RED}Usage: chem add unit <compound> <role> <name>${R}`);
    process.exit(2);
  }

  const [compoundName, role, unitName] = positional;
  const shouldExport = argv.includes("--export");

  const implIdx = argv.indexOf("--implements");
  const impl = implIdx >= 0 ? argv[implIdx + 1] : undefined;

  const wsPath = resolveWorkspace(argv);
  const ws = loadWorkspace(wsPath);
  const wsDir = path.dirname(wsPath);

  // Validate role
  if (!ws.roles[role]) {
    console.error(`${RED}Unknown role "${role}". Known roles: [${Object.keys(ws.roles).join(", ")}]${R}`);
    process.exit(2);
  }

  // Find compound
  const compounds = discoverCompounds(ws, wsDir);
  const target = compounds.find((c) => c.manifest.compound === compoundName);
  if (!target) {
    console.error(`${RED}Compound "${compoundName}" not found.${R}`);
    process.exit(2);
  }

  // Check for duplicate
  const existing = (target.manifest.units ?? []).find((u) => u.name === unitName);
  if (existing) {
    console.error(`${RED}Unit "${unitName}" already exists in compound "${compoundName}".${R}`);
    process.exit(1);
  }

  // Use plugin to determine file path
  const plugin = loadPlugin({ language: ws.language });
  const folder = ws.roles[role].folder;
  const file = "./" + plugin.unitFilePath(role, unitName, folder);

  console.log(`\n${BLD}chem add unit${R}\n`);

  // Update compound.yaml using Document API to preserve formatting
  const manifestFile = ws.rules?.manifest_filename ?? "compound.yaml";
  const manifestPath = path.join(target.dir, manifestFile);
  const raw = fs.readFileSync(manifestPath, "utf-8");
  const doc = parseDocument(raw);

  // Add to units
  const unitEntry: Record<string, unknown> = { role, name: unitName, file };
  if (impl) unitEntry.implements = [impl];

  let units = doc.get("units") as unknown;
  if (!units || !Array.isArray((units as any).items)) {
    doc.set("units", []);
    units = doc.get("units");
  }
  (units as any).add(doc.createNode(unitEntry));

  // Add to exports if requested
  if (shouldExport) {
    const pluralRole = role + "s";
    let exports = doc.get("exports") as any;
    if (!exports) {
      doc.set("exports", {});
      exports = doc.get("exports");
    }
    let roleExports = exports.get(pluralRole);
    if (!roleExports) {
      exports.set(pluralRole, doc.createNode([unitName]));
    } else {
      roleExports.add(doc.createNode(unitName));
    }
  }

  fs.writeFileSync(manifestPath, doc.toString(), "utf-8");
  console.log(`  ${GRN}+${R}  ${compoundName}/${manifestFile} updated`);

  // Scaffold the file
  const reloaded = discoverCompounds(ws, wsDir);
  const result = scaffoldWorkspace(ws, reloaded, plugin, false);

  for (const f of result.created) {
    console.log(`  ${GRN}+${R}  ${path.relative(wsDir, f)}`);
  }

  console.log();
  console.log(`${GRN}${BLD}Unit "${unitName}" (${role}) added to "${compoundName}"${R}\n`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveWorkspace(argv: string[]): string {
  const wsIdx = argv.indexOf("--workspace");
  const wsArg = wsIdx >= 0 ? argv[wsIdx + 1] : "workspace.yaml";
  const wsPath = path.resolve(wsArg);

  if (!fs.existsSync(wsPath)) {
    console.error(`${RED}Workspace file not found: ${wsPath}${R}`);
    process.exit(2);
  }

  return wsPath;
}
