import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  AssayDeclaration,
  InferredUnit,
  LoadedCompound,
  ResolvedImport,
  UnitDeclaration,
  Workspace,
} from "@chemag/core/types";
import { discoverHelperBinary, findGoModule } from "./parser.js";

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/**
 * Convert a PascalCase / camelCase identifier to snake_case for Go file
 * naming. Mirrors the Python plugin's `toSnakeCase` so multi-language
 * workspaces stay consistent.
 */
export function toSnakeCase(name: string): string {
  return name
    .replace(/(.)([A-Z][a-z]+)/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

/**
 * Resolve the package name for a given role folder.
 *
 * Each role folder is its own Go package. The Go spec reserves the
 * keyword `interface` so the conventional folder name `interface` cannot
 * also be a package name — we map it to `iface` instead. All other
 * folders use their literal name lowercased.
 */
export function packageNameForFolder(folder: string): string {
  const base = path.basename(folder).toLowerCase();
  if (base === "interface" || base === "interfaces") return "iface";
  return base;
}

// ---------------------------------------------------------------------------
// Unit stub generation
// ---------------------------------------------------------------------------

function renderImportLines(imports: ResolvedImport[]): string {
  if (imports.length === 0) return "";
  // De-duplicate by import path (Go imports are by package, not by symbol).
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const imp of imports) {
    if (seen.has(imp.fromCompound)) continue;
    seen.add(imp.fromCompound);
    lines.push(`\t"${imp.fromCompound}"`);
  }
  if (lines.length === 0) return "";
  return `import (\n${lines.join("\n")}\n)\n\n`;
}

export function generateUnitStub(unit: UnitDeclaration, imports: ResolvedImport[]): string {
  const folder = path.dirname(unit.file);
  const pkg = packageNameForFolder(folder);
  const head = `package ${pkg}\n\n`;
  const importBlock = renderImportLines(imports);

  switch (unit.role) {
    case "element":
      return `${head}${importBlock}// ${unit.name} is an immutable value object.
type ${unit.name} struct {
\tValue string // TODO: replace with appropriate type
}

// New${unit.name} constructs a ${unit.name}.
func New${unit.name}(value string) ${unit.name} {
\treturn ${unit.name}{Value: value}
}
`;

    case "molecule":
      return `${head}${importBlock}// ${unit.name} is a domain state aggregate.
type ${unit.name} struct {
\t// TODO: add fields
}
`;

    case "reaction":
      return `${head}${importBlock}// ${unit.name} executes the ${unit.name} workflow.
//
// TODO: implement business logic.
func ${unit.name}() error {
\treturn nil
}
`;

    case "interface":
      return `${head}${importBlock}// ${unit.name} defines a capability boundary.
type ${unit.name} interface {
\t// TODO: define methods
}
`;

    case "adapter": {
      const implementsName =
        unit.implements && unit.implements.length > 0 ? unit.implements[0] : null;
      const docLine = implementsName
        ? `// ${unit.name} implements ${implementsName}.\n`
        : `// ${unit.name} is a concrete implementation.\n`;
      const methodStub = implementsName
        ? `\n// Execute satisfies ${implementsName}.\nfunc (a *${unit.name}) Execute() error {\n\treturn nil\n}\n`
        : "";
      return `${head}${importBlock}${docLine}type ${unit.name} struct {
\t// TODO: add dependencies
}
${methodStub}`;
    }

    case "buffer":
      return `${head}${importBlock}// ${unit.name} wraps a reaction for cross-cutting concerns.
//
// TODO: implement middleware logic.
func ${unit.name}(next func() error) func() error {
\treturn func() error {
\t\t// TODO: add pre-processing
\t\tif err := next(); err != nil {
\t\t\treturn err
\t\t}
\t\t// TODO: add post-processing
\t\treturn nil
\t}
}
`;

    default:
      return `${head}${importBlock}// TODO: implement ${unit.name} (${unit.role})\n`;
  }
}

// ---------------------------------------------------------------------------
// Public surface (public.go)
// ---------------------------------------------------------------------------

/**
 * Generate the compound's `public.go` re-export file.
 *
 * Go has no `re-export` syntax — we emulate it with type aliases for
 * types and `var X = innerpkg.X` for values. This lets downstream
 * compounds import `mycompound.UserId` instead of reaching into
 * `mycompound/elements/UserId`.
 *
 * The compound's go.mod (if present) gives us the module path needed for
 * the inner-package import lines.
 */
export function generatePublicSurface(compound: LoadedCompound, workspace: Workspace): string {
  const exports = compound.manifest.exports;
  const compoundName = compound.manifest.compound;
  const header = `// Package ${packageNameForFolder(compoundName)} is the public surface for ${compoundName}.\npackage ${packageNameForFolder(compoundName)}\n`;

  if (!exports || Object.keys(exports).length === 0) {
    return `${header}\n`;
  }

  // Discover module path so we can emit absolute import paths for the
  // inner role packages. Walk up from the compound dir; if no go.mod is
  // found, fall back to relative-style names that still parse but won't
  // resolve at compile time (analyzer-friendly).
  const probe = path.join(compound.dir, "compound.yaml");
  const mod = findGoModule(existsSync(probe) ? probe : compound.dir);
  const baseImport = mod
    ? `${mod.modulePath}/${path.relative(mod.moduleRoot, compound.dir).split(path.sep).join("/")}`
    : compoundName;

  const roles = workspace.roles ?? {};
  const importLines = new Set<string>();
  const aliasLines: string[] = [];

  for (const [roleKey, names] of Object.entries(exports)) {
    // Export keys may be plural (e.g. "interfaces") — strip a trailing 's'.
    const role = roleKey.replace(/s$/, "");
    const folder = roles[role]?.folder ?? role;
    const pkg = packageNameForFolder(folder);
    const importPath = `${baseImport}/${folder}`;
    importLines.add(`\t${pkg} "${importPath}"`);

    // Roles whose units are types (struct/interface) get a type alias.
    // Roles whose units are values (functions, vars) get a var alias.
    const isTypeRole =
      role === "element" || role === "molecule" || role === "interface" || role === "adapter";
    const kw = isTypeRole ? "type" : "var";
    for (const name of names) {
      aliasLines.push(`${kw} ${name} = ${pkg}.${name}`);
    }
  }

  const importBlock =
    importLines.size === 0 ? "" : `\nimport (\n${[...importLines].sort().join("\n")}\n)\n`;
  return `${header}${importBlock}\n${aliasLines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Assay (test) stub generation
// ---------------------------------------------------------------------------

/**
 * Generate a Go `_test.go` stub for a compound assay.
 */
export function generateAssayStub(assay: AssayDeclaration, compound: LoadedCompound): string {
  const pkg = packageNameForFolder(compound.manifest.compound);
  const head = `package ${pkg}_test\n\nimport (\n\t"testing"\n)\n\n`;
  const subjects = assay.subjects ?? [];
  if (subjects.length === 0) {
    return `${head}func TestPlaceholder(t *testing.T) {\n\t// TODO: implement tests\n}\n`;
  }
  const fns = subjects
    .map(
      (s) =>
        `func Test${s}(t *testing.T) {\n\t// TODO: test ${s}\n\tt.Skip("not implemented")\n}\n`,
    )
    .join("\n");
  return `${head}${fns}`;
}

// ---------------------------------------------------------------------------
// Import formatting
// ---------------------------------------------------------------------------

/**
 * Format a single Go import line. Go has no notion of "type-only"
 * imports — the `isTypeOnly` flag is preserved in a leading comment so
 * round-trips through `formatImportStatement` keep the metadata visible.
 */
export function formatImportStatement(from: string, _to: string, isTypeOnly: boolean): string {
  const prefix = isTypeOnly ? "// type-only: " : "";
  return `${prefix}import "${from}"`;
}

// ---------------------------------------------------------------------------
// Unit inference (sync)
// ---------------------------------------------------------------------------

/**
 * Scan a role directory for Go files and infer unit declarations.
 *
 * Files of the form `snake_case.go` map to PascalCase unit names. Test
 * files (`*_test.go`) are excluded; so are `public.go` and `doc.go`
 * which are conventional and don't represent a unit.
 */
export function inferUnits(dir: string, roleFolder: string, role: string): InferredUnit[] {
  const fullDir = path.join(dir, roleFolder);
  let entries: string[];
  try {
    entries = readdirSync(fullDir);
  } catch {
    return [];
  }

  const units: InferredUnit[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".go")) continue;
    if (entry.endsWith("_test.go")) continue;
    if (entry === "public.go" || entry === "doc.go") continue;

    const baseName = entry.replace(/\.go$/, "");
    const name = baseName
      .split("_")
      .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
      .join("");

    const filePath = path.join(fullDir, entry);
    const exports = extractGoExports(filePath);

    units.push({
      name,
      role,
      fileName: entry,
      exports,
    });
  }

  return units;
}

/**
 * Extract exported (capitalized) top-level identifiers from a Go file.
 * Simple regex sweep — sufficient for `inferUnits`'s heuristic role.
 */
function extractGoExports(filePath: string): string[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const exports = new Set<string>();
  const patterns: RegExp[] = [
    /^\s*type\s+([A-Z]\w*)/gm,
    /^\s*func\s+([A-Z]\w*)\s*\(/gm,
    /^\s*func\s+\([^)]+\)\s+([A-Z]\w*)\s*\(/gm,
    /^\s*var\s+([A-Z]\w*)/gm,
    /^\s*const\s+([A-Z]\w*)/gm,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const name = match[1];
      if (name) exports.add(name);
    }
  }
  return [...exports];
}

// ---------------------------------------------------------------------------
// Implements inference (uses the Go helper binary)
// ---------------------------------------------------------------------------

/**
 * Infer the interface(s) a Go type implements by asking the helper
 * binary to inspect the source file. If the helper isn't available
 * (e.g. local dev with no prebuilt binary) we return an empty list —
 * mirrors the Python plugin's degraded-mode behavior.
 */
export function inferImplements(filePath: string): string[] {
  const helper = discoverHelperBinary();
  if (!helper) return [];

  const request = JSON.stringify({ method: "inferImplements", params: { file: filePath } });
  const result = spawnSync(helper, [], {
    input: `${request}\n`,
    encoding: "utf-8",
    timeout: 10_000,
  });
  if (result.error || result.status !== 0 || !result.stdout) return [];

  try {
    const firstLine = result.stdout.split(/\r?\n/, 1)[0] ?? "";
    const parsed = JSON.parse(firstLine) as { ok: boolean; result?: string[]; error?: string };
    if (!parsed.ok || !Array.isArray(parsed.result)) return [];
    return parsed.result;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// CLAUDE.md generation
// ---------------------------------------------------------------------------

export function generateClaudeMd(_workspaceName: string): string {
  return `## Language: Go

### Conventions

- **Naming**: All source files use \`snake_case.go\` (e.g., \`UserId\` → \`user_id.go\`).
- **Packages**: Each role folder is its own Go package; the package name is the folder name lowercased. The folder \`interface/\` maps to the package name \`iface\` because \`interface\` is a reserved word in Go.
- **Public surface**: Each compound exposes its API via \`public.go\` using \`type X = innerpkg.X\` for types and \`var X = innerpkg.X\` for values.
- **Value objects**: Plain structs with constructor functions (\`New<Name>\`).
- **Domain state**: Plain structs with exported fields and methods.
- **Ports / interfaces**: Go \`interface\` types in the \`iface\` package.
- **Adapters**: Concrete structs that satisfy a port via method-set matching.
- **Use-cases / reactions**: Plain functions returning \`error\`.
- **Middleware / buffers**: Higher-order functions wrapping a \`func() error\`.
- **Testing**: Use the standard \`testing\` package. Test files follow the \`*_test.go\` pattern.

### Import Rules

- Cross-compound imports go through the compound's \`public.go\` — never reach into another compound's role packages.
- Use-cases / reactions depend on ports / interfaces, never on adapters.
- Value-objects / elements depend only on other value-objects / elements.
- Adapters are the only role that touches the outside world (DB, network, OS).
`;
}
