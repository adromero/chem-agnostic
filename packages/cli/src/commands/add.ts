import * as fs from "node:fs";
import * as path from "node:path";
import { parseDocument, stringify } from "yaml";
import { loadWorkspace, discoverCompounds } from "@chemag/core/loader";
import { loadPlugin } from "../plugin-loader.js";
import { scaffoldWorkspace } from "@chemag/core/scaffold";
import { applyWorkspaceVocabulary, tr } from "@chemag/core/vocabulary";

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const DIM = "\x1b[2m";
const BLD = "\x1b[1m";

export function cmdAdd(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help") || argv.length < 2) {
    console.log(`\n${BLD}${tr("cli.command.add")}${R}\n`);
    console.log(
      `${BLD}Module options:${R}\n  --type <type>       module (default), shared-kernel, or infrastructure\n  --workspace <file>  Path to workspace.yaml (default: ./workspace.yaml)\n\n${BLD}Unit options:${R}\n  --workspace <file>  Path to workspace.yaml (default: ./workspace.yaml)\n  --export            Also add to the module's exports\n  --implements <name> Port this adapter implements (adapter role only)\n\n${BLD}Examples:${R}\n  ${DIM}chemag add module payments${R}\n  ${DIM}chemag add module identity --type shared-kernel${R}\n  ${DIM}chemag add unit reporting value-object InvoiceId${R}\n  ${DIM}chemag add unit reporting adapter PgReportRepo --implements ReportRepository --export${R}\n`,
    );
    process.exit(0);
  }

  const sub = argv[0];

  // Accept both vocabularies: "compound"/"module" target the same code path.
  if (sub === "compound" || sub === "module") {
    addCompound(argv.slice(1));
  } else if (sub === "unit") {
    addUnit(argv.slice(1));
  } else {
    console.error(`${RED}Unknown add target: "${sub}". Use "compound"/"module" or "unit".${R}`);
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
  applyWorkspaceVocabulary(ws);
  const wsDir = path.dirname(wsPath);

  const typeIdx = argv.indexOf("--type");
  const type = typeIdx >= 0 ? argv[typeIdx + 1] : "compound";
  // Map vocabulary-aliased type names back to canonical workspace type names.
  const canonicalType =
    type === "module"
      ? "compound"
      : type === "shared-kernel"
        ? "reagent"
        : type === "infrastructure"
          ? "solvent"
          : type;

  // Determine directory using the canonical type
  let baseDir: string;
  switch (canonicalType) {
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

  // Write compound.yaml — the YAML field names are stable across vocabularies.
  const manifest: Record<string, unknown> = {
    compound: name,
  };
  if (canonicalType !== "compound") manifest.type = canonicalType;
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
  applyWorkspaceVocabulary(ws);
  const wsDir = path.dirname(wsPath);

  // Validate role
  if (!ws.roles[role]) {
    console.error(
      `${RED}Unknown role "${role}". Known roles: [${Object.keys(ws.roles).join(", ")}]${R}`,
    );
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
  const file = `./${plugin.unitFilePath(role, unitName, folder)}`;

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
    const pluralRole = `${role}s`;
    let exports = doc.get("exports") as any;
    if (!exports) {
      doc.set("exports", {});
      exports = doc.get("exports");
    }
    const roleExports = exports.get(pluralRole);
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
