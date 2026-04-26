import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  AssayDeclaration,
  InferredUnit,
  LoadedCompound,
  ResolvedImport,
  UnitDeclaration,
  Workspace,
} from "@chemag/core/types";
import { discoverPython } from "./parser.js";

// ---------------------------------------------------------------------------
// Snake_case conversion
// ---------------------------------------------------------------------------

export function toSnakeCase(name: string): string {
  return name
    .replace(/(.)([A-Z][a-z]+)/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Unit stub generation
// ---------------------------------------------------------------------------

export function generateUnitStub(unit: UnitDeclaration, _imports: ResolvedImport[]): string {
  switch (unit.role) {
    case "element":
      return generateElementStub(unit);
    case "molecule":
      return generateMoleculeStub(unit);
    case "reaction":
      return generateReactionStub(unit);
    case "interface":
      return generateInterfaceStub(unit);
    case "adapter":
      return generateAdapterStub(unit);
    case "buffer":
      return generateBufferStub(unit);
    default:
      return `# ${unit.name} (${unit.role})\n\nraise NotImplementedError("Unknown role: ${unit.role}")\n`;
  }
}

function generateElementStub(unit: UnitDeclaration): string {
  const snakeName = toSnakeCase(unit.name);
  return `"""${unit.name} — immutable value object."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ${unit.name}:
    """Immutable value object."""

    value: str  # TODO: replace with appropriate type

    def __str__(self) -> str:
        return f"${unit.name}({self.value})"

    def __repr__(self) -> str:
        return f"${unit.name}(value={self.value!r})"
`;
}

function generateMoleculeStub(unit: UnitDeclaration): string {
  return `"""${unit.name} — domain state object."""

from dataclasses import dataclass


@dataclass
class ${unit.name}:
    """Domain state composed of elements and molecules."""

    # TODO: add fields
    pass
`;
}

function generateReactionStub(unit: UnitDeclaration): string {
  const funcName = toSnakeCase(unit.name);
  return `"""${unit.name} — workflow / use case."""


async def ${funcName}() -> None:
    """Execute the ${unit.name} workflow.

    TODO: implement business logic.
    """
    raise NotImplementedError
`;
}

function generateInterfaceStub(unit: UnitDeclaration): string {
  return `"""${unit.name} — interface / contract."""

from abc import ABC, abstractmethod


class ${unit.name}(ABC):
    """Defines a capability boundary."""

    @abstractmethod
    async def execute(self) -> None:
        """TODO: define interface methods."""
        ...
`;
}

function generateAdapterStub(unit: UnitDeclaration): string {
  const implementsName = unit.implements && unit.implements.length > 0 ? unit.implements[0] : null;
  const baseClass = implementsName ?? "object";
  const docstring = implementsName
    ? `"""Implements: ${implementsName}"""`
    : `"""Concrete implementation."""`;

  const importLine = implementsName
    ? `# TODO: import ${implementsName} from the appropriate interface module\n\n\n`
    : "\n";

  const methodStub = implementsName
    ? `
    async def execute(self) -> None:
        """TODO: implement."""
        raise NotImplementedError`
    : `
    pass  # TODO: implement`;

  return `"""${unit.name} — adapter implementation."""

${importLine}class ${unit.name}(${baseClass}):
    ${docstring}
${methodStub}
`;
}

function generateBufferStub(unit: UnitDeclaration): string {
  const funcName = toSnakeCase(unit.name);
  return `"""${unit.name} — buffer / middleware."""

from typing import Any, Awaitable, Callable


def ${funcName}(
    next_fn: Callable[..., Awaitable[Any]],
) -> Callable[..., Awaitable[Any]]:
    """Wrap a reaction for cross-cutting concerns.

    TODO: implement middleware logic.
    """

    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        # TODO: add pre-processing
        result = await next_fn(*args, **kwargs)
        # TODO: add post-processing
        return result

    return wrapper
`;
}

// ---------------------------------------------------------------------------
// Public surface generation (__init__.py)
// ---------------------------------------------------------------------------

export function generatePublicSurface(compound: LoadedCompound, workspace: Workspace): string {
  const exports = compound.manifest.exports;
  if (!exports || Object.keys(exports).length === 0) {
    return `"""${compound.manifest.compound} — public surface."""\n`;
  }

  const lines: string[] = [`"""${compound.manifest.compound} — public surface."""`, ""];

  const roles = workspace.roles;

  for (const [role, names] of Object.entries(exports)) {
    const roleFolder = roles[role]?.folder ?? role;
    for (const name of names) {
      const moduleName = toSnakeCase(name);
      lines.push(`from .${roleFolder}.${moduleName} import ${name}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Assay (test) stub generation
// ---------------------------------------------------------------------------

export function generateAssayStub(assay: AssayDeclaration, compound: LoadedCompound): string {
  const compoundName = compound.manifest.compound;
  const subjectImports = (assay.subjects ?? []).map((s) => `    ${s},`).join("\n");

  const importBlock =
    assay.subjects && assay.subjects.length > 0
      ? `from ${compoundName} import (\n${subjectImports}\n)\n`
      : "";

  const testFunctions = (assay.subjects ?? [])
    .map((s) => {
      const snakeName = toSnakeCase(s);
      return `\ndef test_${snakeName}() -> None:\n    """Test ${s}."""\n    # TODO: implement test\n    assert True\n`;
    })
    .join("");

  return `"""Tests for ${assay.name}."""

import pytest

${importBlock}${testFunctions || `\ndef test_placeholder() -> None:\n    """TODO: implement tests."""\n    assert True\n`}`;
}

// ---------------------------------------------------------------------------
// Import formatting
// ---------------------------------------------------------------------------

export function formatImportStatement(from: string, to: string, isTypeOnly: boolean): string {
  if (isTypeOnly) {
    return `from typing import TYPE_CHECKING\n\nif TYPE_CHECKING:\n    from ${from} import ${to}`;
  }
  return `from ${from} import ${to}`;
}

// ---------------------------------------------------------------------------
// Unit inference
// ---------------------------------------------------------------------------

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
    if (!entry.endsWith(".py")) continue;
    if (entry === "__init__.py") continue;
    if (entry.startsWith("test_")) continue;
    if (entry.endsWith(".pyi")) continue;
    if (entry === "conftest.py") continue;

    const baseName = entry.replace(/\.py$/, "");
    // Convert snake_case filename to PascalCase name
    const name = baseName
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");

    // Try to read exports from the file
    const filePath = path.join(fullDir, entry);
    const fileExports = extractPythonExports(filePath);

    units.push({
      name,
      role,
      fileName: entry,
      exports: fileExports,
    });
  }

  return units;
}

function extractPythonExports(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const exports: string[] = [];

    const patterns: RegExp[] = [
      // Class definitions
      /^class\s+(\w+)/gm,
      // Top-level function definitions
      /^def\s+(\w+)/gm,
      // Top-level async function definitions
      /^async\s+def\s+(\w+)/gm,
    ];

    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        if (match[1] && !match[1].startsWith("_")) {
          exports.push(match[1]);
        }
      }
    }

    return exports;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Implements inference
// ---------------------------------------------------------------------------

const INFER_IMPLEMENTS_SCRIPT = `
import ast
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    source = f.read()

tree = ast.parse(source, filename=path)
results = []

for node in ast.walk(tree):
    if isinstance(node, ast.ClassDef):
        for base in node.bases:
            if isinstance(base, ast.Name):
                results.append(base.id)
            elif isinstance(base, ast.Attribute):
                results.append(base.attr)
        # Also check docstring for "Implements: X"
        if (
            node.body
            and isinstance(node.body[0], ast.Expr)
            and isinstance(node.body[0].value, ast.Constant)
            and isinstance(node.body[0].value.value, str)
        ):
            doc = node.body[0].value.value
            if "Implements:" in doc:
                parts = doc.split("Implements:")
                for part in parts[1:]:
                    iface = part.strip().split()[0].rstrip(",.")
                    if iface:
                        results.append(iface)

# Deduplicate while preserving order
seen = set()
unique = []
for r in results:
    if r not in seen and r not in ("ABC", "object"):
        seen.add(r)
        unique.append(r)

json.dump(unique, sys.stdout)
`;

export function inferImplements(filePath: string): string[] {
  try {
    const pythonPath = discoverPython();
    const stdout = execFileSync(pythonPath, ["-c", INFER_IMPLEMENTS_SCRIPT, filePath], {
      timeout: 10_000,
      encoding: "utf-8",
    });
    return JSON.parse(stdout) as string[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// CLAUDE.md generation
// ---------------------------------------------------------------------------

export function generateClaudeMd(workspaceName: string): string {
  return `# ${workspaceName} — Chem Architecture

This project uses **Chem**, a chemistry-inspired software architecture. Read this entire file before writing any code.

## Core Concept

Code is organized into **compounds** (feature modules). Each compound contains **units** — source files with assigned **roles**. Roles determine what a unit can depend on. These dependency rules are called **bonds**.

Every compound has a manifest (\`compound.yaml\`) declaring its units, exports, and imports. The workspace config (\`workspace.yaml\`) defines the global rules.

**Before writing any code**: read \`workspace.yaml\`, then the target compound's \`compound.yaml\`.

## Language: Python

### Conventions

- **Naming**: All module files use \`snake_case.py\` (e.g., \`UserProfile\` → \`user_profile.py\`).
- **Public surface**: Each compound exposes exports via \`__init__.py\` re-exports.
- **Value objects**: Use \`@dataclass(frozen=True)\` from the \`dataclasses\` module for elements.
- **Domain state**: Use \`@dataclass\` for molecules.
- **Interfaces**: Use \`ABC\` and \`@abstractmethod\` from the \`abc\` module.
- **Adapters**: Inherit from their interface class. Document with \`"""Implements: InterfaceName"""\`.
- **Reactions**: Async functions (\`async def\`) that orchestrate domain logic.
- **Buffers**: Decorator functions that wrap \`next_fn\` for cross-cutting concerns.
- **Testing**: Use \`pytest\`. Test files follow the \`test_*.py\` pattern.

### Import Rules

- Cross-compound imports go through \`__init__.py\` — never import internal modules directly.
- Use relative imports within a compound (e.g., \`from .elements.user_id import UserId\`).
- Reactions depend on interfaces, never on adapters.
- Elements are pure — they depend only on other elements.
- Adapters are the only role that touches the outside world.

## Roles — What Each Unit Type Means

| Role | What it is | Python pattern |
|------|-----------|----------------|
| **element** | Immutable value object | \`@dataclass(frozen=True)\` |
| **molecule** | Domain state | \`@dataclass\` |
| **reaction** | Workflow / use case | \`async def reaction_name() -> None\` |
| **interface** | Contract / port | \`class Name(ABC)\` with \`@abstractmethod\` |
| **adapter** | Implementation of interface | \`class Name(InterfaceName)\` |
| **buffer** | Middleware decorator | \`def name(next_fn) -> wrapped_fn\` |

## Bond Rules — What Can Depend on What

| Role | Can depend on |
|------|--------------|
| element | element |
| molecule | element, molecule |
| reaction | element, molecule, interface |
| interface | element, molecule |
| adapter | element, molecule, interface, adapter |
| buffer | element, molecule, interface |

## Workflow

### Adding a new compound:
\`\`\`bash
chem add compound <name>
chem add unit <name> element SomeId --export
chem add unit <name> molecule SomeEntity --export
chem add unit <name> interface SomeRepo --export
chem add unit <name> adapter PgSomeRepo --implements SomeRepo
chem add unit <name> reaction do_something --export
\`\`\`

### Validation:
\`\`\`bash
chem check workspace.yaml
chem analyze workspace.yaml
\`\`\`

## Rules for AI Assistants

1. **Read before write.** Always read \`workspace.yaml\` and the target \`compound.yaml\` before touching any code.
2. **Use the tool.** Use \`chem add\` to create new compounds and units — don't create files manually.
3. **Respect bonds.** Never import across role boundaries. If the analyzer fails, fix the violation.
4. **Public surface only.** Cross-compound imports go through \`__init__.py\`. Never import internal files.
5. **Validate after changes.** Run \`chem check workspace.yaml && chem analyze workspace.yaml\` after every meaningful change.
6. **Adapters are leaf nodes.** They implement interfaces and are only instantiated in the catalyst.
7. **Reactions are the entry points.** They orchestrate the domain logic. External callers invoke reactions, not molecules directly.
8. **When in doubt, read the manifest.** The \`compound.yaml\` is the source of truth for what exists and how it connects.
`;
}
