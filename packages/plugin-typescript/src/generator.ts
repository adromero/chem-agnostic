import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AssayDeclaration,
  InferredUnit,
  LoadedCompound,
  ResolvedImport,
  UnitDeclaration,
  Workspace,
} from "@chemag/core/types";

// ---------------------------------------------------------------------------
// Import rendering
// ---------------------------------------------------------------------------

/**
 * Format a TypeScript import statement.
 */
export function formatImportStatement(from: string, to: string, isTypeOnly: boolean): string {
  const kw = isTypeOnly ? "import type" : "import";
  return `${kw} { ${from} } from "${to}";`;
}

/**
 * Build import lines for a unit from its resolved imports.
 * Converts ResolvedImport[] (compound/unit identity) into renderable
 * TS import lines, merging imports from the same source.
 */
function renderImportLines(imports: ResolvedImport[]): string {
  if (imports.length === 0) return "";

  const lines = imports.map((imp) =>
    formatImportStatement(imp.names.join(", "), imp.fromCompound, imp.isTypeOnly),
  );
  return `${lines.join("\n")}\n\n`;
}

// ---------------------------------------------------------------------------
// Unit stub generation
// ---------------------------------------------------------------------------

/**
 * Generate a role-specific TypeScript stub for a unit declaration.
 */
export function generateUnitStub(unit: UnitDeclaration, imports: ResolvedImport[]): string {
  const head = renderImportLines(imports);

  switch (unit.role) {
    case "element":
      return `${head}export class ${unit.name} {\n  constructor(readonly value: string) {}\n}\n`;

    case "molecule":
      return `${head}export class ${unit.name} {\n  constructor() {\n    // TODO: implement\n  }\n}\n`;

    case "reaction":
      return `${head}export async function ${unit.name}(): Promise<void> {\n  // TODO: implement\n}\n`;

    case "interface":
      return `${head}export interface ${unit.name} {\n  // TODO: define methods\n}\n`;

    case "adapter": {
      const impl = (unit.implements ?? []).join(", ");
      const clause = impl ? ` implements ${impl}` : "";
      return `${head}export class ${unit.name}${clause} {\n  // TODO: implement\n}\n`;
    }

    case "buffer":
      return `${head}export function ${unit.name}(\n  next: () => Promise<void>,\n): Promise<void> {\n  // TODO: implement\n  return next();\n}\n`;

    default:
      return `// TODO: implement ${unit.name} (${unit.role})\n`;
  }
}

// ---------------------------------------------------------------------------
// Public surface (barrel file)
// ---------------------------------------------------------------------------

/**
 * Generate the public surface module (re-exports) for a compound.
 * Uses `export type` for interfaces.
 */
export function generatePublicSurface(compound: LoadedCompound, _workspace: Workspace): string {
  if (!compound.manifest.exports) return "";

  const lines: string[] = [];

  for (const [roleKey, names] of Object.entries(compound.manifest.exports)) {
    // Export keys are plural (e.g. "interfaces"), strip trailing 's' to get role
    const role = roleKey.replace(/s$/, "");

    for (const name of names) {
      const unit = (compound.manifest.units ?? []).find((u) => u.name === name);
      if (!unit) continue;

      let rel = unit.file.replace(/\.ts$/, "").replace(/\\/g, "/");
      if (!rel.startsWith(".")) rel = `./${rel}`;

      const kw = role === "interface" ? "export type" : "export";
      lines.push(`${kw} { ${name} } from "${rel}";`);
    }
  }

  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Assay (test) stub generation
// ---------------------------------------------------------------------------

/**
 * Generate a stub test file for a compound assay.
 */
export function generateAssayStub(assay: AssayDeclaration, compound: LoadedCompound): string {
  const assayAbs = path.resolve(compound.dir, assay.file);
  const assayDir = path.dirname(assayAbs);

  const importLines: string[] = [];
  for (const subject of assay.subjects ?? []) {
    const unit = (compound.manifest.units ?? []).find((u) => u.name === subject);
    if (!unit) continue;

    const unitAbs = path.resolve(compound.dir, unit.file);
    const rel = formatRelativeImport(assayDir, unitAbs);
    importLines.push(`import { ${subject} } from "${rel}";`);
  }

  const head = importLines.length > 0 ? `${importLines.join("\n")}\n\n` : "";
  const label = (assay.subjects ?? []).join(", ") || assay.name;

  return `${head}describe("${label}", () => {\n  it.todo("should work");\n});\n`;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/**
 * Format a relative import path between two file locations.
 * Strips .ts extension for TypeScript module specifiers.
 */
export function formatRelativeImport(fromDir: string, toFile: string): string {
  let rel = path.relative(fromDir, toFile).replace(/\\/g, "/").replace(/\.ts$/, "");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

// ---------------------------------------------------------------------------
// Inference (sync)
// ---------------------------------------------------------------------------

/**
 * Scan a role directory for TypeScript files and infer unit declarations.
 */
export function inferUnits(dir: string, roleFolder: string, role: string): InferredUnit[] {
  const roleDir = path.join(dir, roleFolder);
  if (!fs.existsSync(roleDir)) return [];

  let files: string[];
  try {
    files = fs
      .readdirSync(roleDir)
      .filter(
        (f) =>
          f.endsWith(".ts") &&
          !f.endsWith(".test.ts") &&
          !f.endsWith(".spec.ts") &&
          !f.endsWith(".d.ts"),
      );
  } catch {
    return [];
  }

  const units: InferredUnit[] = [];

  for (const file of files) {
    const name = file.replace(/\.ts$/, "");
    const filePath = path.join(roleDir, file);

    const unit: InferredUnit = {
      name,
      role,
      fileName: `./${roleFolder}/${file}`,
      exports: inferExports(filePath),
    };

    if (role === "adapter") {
      const impl = inferImplements(filePath);
      if (impl.length > 0) {
        unit.implements = impl[0];
      }
    }

    units.push(unit);
  }

  return units;
}

/**
 * Infer which interfaces a file implements by inspecting its source.
 * Looks for `implements X` or `implements X, Y` patterns.
 */
export function inferImplements(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(/implements\s+([\w\s,]+)\s*\{/);
    if (match) {
      return match[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch {
    // File doesn't exist or unreadable
  }
  return [];
}

/**
 * Infer export names from a TypeScript source file (basic heuristic).
 */
function inferExports(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const names: string[] = [];
    const exportPattern = /export\s+(?:class|interface|function|const|type|enum)\s+(\w+)/g;
    for (const match of content.matchAll(exportPattern)) {
      names.push(match[1]);
    }
    return names;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// CLAUDE.md generation
// ---------------------------------------------------------------------------

/**
 * Generate the language-specific CLAUDE.md sections for a TypeScript workspace.
 *
 * The core template (`@chemag/core/template-claude-md`) emits the
 * vocabulary-aware shared sections (intro, roles table, bond rules, etc.)
 * — this function only adds the TypeScript-specific section that the core
 * template extracts and splices into the final document. The plugin output
 * intentionally references `public.ts` to make TypeScript-specific guidance
 * visible in the rendered file.
 */
export function generateClaudeMd(_workspaceName: string): string {
  return `## Cross-Compound Imports (TypeScript)

- **ALWAYS** import through \`public.ts\` — never reach into another module's internals.
- Each module's \`public.ts\` is its membrane — only what's listed in \`exports\` is available.
- Cross-cutting infrastructure modules (those marked \`implicit: true\`) are available without an explicit import declaration.
`;
}
