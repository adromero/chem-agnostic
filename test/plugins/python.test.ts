import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { pythonPlugin } from "../../plugins/python/index.js";
import { toSnakeCase } from "../../plugins/python/generator.js";
import { discoverPython } from "../../plugins/python/parser.js";

// Gate all Python tests behind python3 availability
const hasPython = (() => {
  try {
    execSync("which python3");
    return true;
  } catch {
    return false;
  }
})();

const describeIfPython = hasPython ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Snake_case conversion (no Python needed)
// ---------------------------------------------------------------------------

describe("toSnakeCase", () => {
  it("converts UserProfile to user_profile", () => {
    expect(toSnakeCase("UserProfile")).toBe("user_profile");
  });

  it("converts HTTPServer to http_server", () => {
    expect(toSnakeCase("HTTPServer")).toBe("http_server");
  });

  it("converts OAuth2Provider to o_auth2_provider", () => {
    expect(toSnakeCase("OAuth2Provider")).toBe("o_auth2_provider");
  });

  it("converts MyXMLParser to my_xml_parser", () => {
    expect(toSnakeCase("MyXMLParser")).toBe("my_xml_parser");
  });

  it("converts InvoiceId to invoice_id", () => {
    expect(toSnakeCase("InvoiceId")).toBe("invoice_id");
  });
});

// ---------------------------------------------------------------------------
// Plugin basics (no Python needed)
// ---------------------------------------------------------------------------

describe("pythonPlugin basics", () => {
  it("has correct name and extensions", () => {
    expect(pythonPlugin.name).toBe("python");
    expect(pythonPlugin.fileExtensions).toEqual([".py"]);
  });

  it("has correct defaults", () => {
    expect(pythonPlugin.defaults.publicSurface).toBe("__init__.py");
    expect(pythonPlugin.defaults.testFilePattern).toEqual(/test_.*\.py$/);
    expect(pythonPlugin.defaults.testFrameworkImport).toBe("pytest");
  });

  it("isSourceFile accepts normal .py files", () => {
    expect(pythonPlugin.isSourceFile("user_profile.py")).toBe(true);
    expect(pythonPlugin.isSourceFile("order.py")).toBe(true);
  });

  it("isSourceFile rejects __pycache__ files", () => {
    expect(pythonPlugin.isSourceFile("__pycache__/foo.py")).toBe(false);
  });

  it("isSourceFile rejects conftest.py", () => {
    expect(pythonPlugin.isSourceFile("conftest.py")).toBe(false);
  });

  it("isSourceFile rejects .pyi files", () => {
    expect(pythonPlugin.isSourceFile("types.pyi")).toBe(false);
  });

  it("isSourceFile rejects test_ files", () => {
    expect(pythonPlugin.isSourceFile("test_something.py")).toBe(false);
  });

  it("isSourceFile rejects non-.py files", () => {
    expect(pythonPlugin.isSourceFile("module.ts")).toBe(false);
  });

  it("unitFilePath produces snake_case .py path", () => {
    expect(pythonPlugin.unitFilePath("element", "UserId", "elements")).toBe(
      "elements/user_id.py",
    );
    expect(
      pythonPlugin.unitFilePath("molecule", "UserProfile", "molecules"),
    ).toBe("molecules/user_profile.py");
  });
});

// ---------------------------------------------------------------------------
// Unit stub generation (no Python needed for generation, but we verify syntax)
// ---------------------------------------------------------------------------

describeIfPython("generateUnitStub", () => {
  const roles = [
    "element",
    "molecule",
    "reaction",
    "interface",
    "adapter",
    "buffer",
  ] as const;

  for (const role of roles) {
    it(`generates syntactically valid Python for role: ${role}`, () => {
      const unit = {
        role,
        name: "TestUnit",
        file: "test_unit.py",
        implements: role === "adapter" ? ["SomeInterface"] : undefined,
      };
      const stub = pythonPlugin.generateUnitStub(unit, []);

      // Verify it's valid Python by running python3 -c "compile(...)"
      const pythonPath = discoverPython();
      // Use ast.parse to check syntax validity
      const checkScript = `
import ast, sys
code = sys.stdin.read()
try:
    ast.parse(code)
    print("OK")
except SyntaxError as e:
    print(f"SYNTAX_ERROR: {e}")
    sys.exit(1)
`;
      const result = execFileSync(pythonPath, ["-c", checkScript], {
        input: stub,
        encoding: "utf-8",
        timeout: 10_000,
      });
      expect(result.trim()).toBe("OK");
    });
  }
});

// ---------------------------------------------------------------------------
// Import parsing (requires Python)
// ---------------------------------------------------------------------------

describeIfPython("parseImports", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "chem-python-test-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePy(name: string, content: string): string {
    const filePath = path.join(tmpDir, name);
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  it("parses 'import X'", () => {
    const fp = writePy(
      "import_x.py",
      `import os\nimport sys\n`,
    );
    const imports = pythonPlugin.parseImports(fp);
    expect(imports).toHaveLength(2);
    expect(imports[0]).toMatchObject({
      moduleSpecifier: "os",
      names: ["os"],
      isTypeOnly: false,
    });
    expect(imports[1]).toMatchObject({
      moduleSpecifier: "sys",
      names: ["sys"],
      isTypeOnly: false,
    });
  });

  it("parses 'from X import Y'", () => {
    const fp = writePy(
      "from_x.py",
      `from os.path import join, exists\n`,
    );
    const imports = pythonPlugin.parseImports(fp);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({
      moduleSpecifier: "os.path",
      names: ["join", "exists"],
      isTypeOnly: false,
    });
  });

  it("parses 'from . import Z' (relative)", () => {
    const fp = writePy(
      "rel_import.py",
      `from . import sibling\n`,
    );
    const imports = pythonPlugin.parseImports(fp);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({
      moduleSpecifier: ".",
      names: ["sibling"],
      isTypeOnly: false,
    });
  });

  it("parses 'from ..pkg import W' (double-dot relative)", () => {
    const fp = writePy(
      "rel_import2.py",
      `from ..pkg import Widget\n`,
    );
    const imports = pythonPlugin.parseImports(fp);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({
      moduleSpecifier: "..pkg",
      names: ["Widget"],
      isTypeOnly: false,
    });
  });

  it("marks TYPE_CHECKING imports as type-only", () => {
    const fp = writePy(
      "type_check.py",
      `from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import User

import os
`,
    );
    const imports = pythonPlugin.parseImports(fp);
    // First import: typing.TYPE_CHECKING itself
    // Second: User under TYPE_CHECKING guard -> isTypeOnly
    // Third: os -> not type-only
    const userImport = imports.find(
      (i) => i.moduleSpecifier === ".models",
    );
    expect(userImport).toBeDefined();
    expect(userImport!.isTypeOnly).toBe(true);

    const osImport = imports.find((i) => i.moduleSpecifier === "os");
    expect(osImport).toBeDefined();
    expect(osImport!.isTypeOnly).toBe(false);
  });

  it("skips from __future__ import", () => {
    const fp = writePy(
      "future.py",
      `from __future__ import annotations\nimport os\n`,
    );
    const imports = pythonPlugin.parseImports(fp);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.moduleSpecifier).toBe("os");
  });

  it("handles files with syntax errors gracefully", () => {
    const fp = writePy(
      "bad_syntax.py",
      `def foo(\n`,
    );
    // Should not throw, just return empty imports for that file
    const imports = pythonPlugin.parseImports(fp);
    expect(imports).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Batch parsing
// ---------------------------------------------------------------------------

describeIfPython("parseImportsBatch", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "chem-python-batch-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses multiple files in one call", () => {
    const fp1 = path.join(tmpDir, "a.py");
    const fp2 = path.join(tmpDir, "b.py");
    writeFileSync(fp1, "import os\n", "utf-8");
    writeFileSync(fp2, "from sys import argv\n", "utf-8");

    const result = pythonPlugin.parseImportsBatch([fp1, fp2]);
    expect(result.size).toBe(2);
    expect(result.get(fp1)).toHaveLength(1);
    expect(result.get(fp2)).toHaveLength(1);
  });

  it("returns empty map for empty input", () => {
    const result = pythonPlugin.parseImportsBatch([]);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// __init__.py generation
// ---------------------------------------------------------------------------

describe("generatePublicSurface", () => {
  it("generates __init__.py re-exports matching compound exports", () => {
    const compound = {
      manifest: {
        compound: "orders",
        exports: {
          element: ["OrderId"],
          molecule: ["Order"],
          reaction: ["CreateOrder"],
        },
      },
      dir: "/tmp/orders",
    };
    const workspace = {
      workspace: "test",
      language: "python",
      roles: {
        element: { description: "Value", folder: "elements" },
        molecule: { description: "State", folder: "molecules" },
        reaction: { description: "Workflow", folder: "reactions" },
      },
      bonds: {},
      paths: { compounds: "compounds" },
    };

    const result = pythonPlugin.generatePublicSurface(compound, workspace);
    expect(result).toContain(
      "from .elements.order_id import OrderId",
    );
    expect(result).toContain(
      "from .molecules.order import Order",
    );
    expect(result).toContain(
      "from .reactions.create_order import CreateOrder",
    );
  });

  it("generates minimal __init__.py for compound with no exports", () => {
    const compound = {
      manifest: {
        compound: "empty",
      },
      dir: "/tmp/empty",
    };
    const workspace = {
      workspace: "test",
      language: "python",
      roles: {},
      bonds: {},
      paths: { compounds: "compounds" },
    };

    const result = pythonPlugin.generatePublicSurface(compound, workspace);
    expect(result).toContain("empty");
  });
});

// ---------------------------------------------------------------------------
// inferImplements (requires Python)
// ---------------------------------------------------------------------------

describeIfPython("inferImplements", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "chem-python-impl-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects ABC inheritance", () => {
    const fp = path.join(tmpDir, "adapter.py");
    writeFileSync(
      fp,
      `from abc import ABC, abstractmethod

class PaymentGateway(ABC):
    @abstractmethod
    def pay(self) -> None: ...

class StripeGateway(PaymentGateway):
    """Implements: PaymentGateway"""
    def pay(self) -> None:
        pass
`,
      "utf-8",
    );
    const result = pythonPlugin.inferImplements(fp);
    expect(result).toContain("PaymentGateway");
  });

  it("detects Implements docstring", () => {
    const fp = path.join(tmpDir, "impl.py");
    writeFileSync(
      fp,
      `class MyAdapter(object):
    """Implements: SomeInterface"""
    pass
`,
      "utf-8",
    );
    const result = pythonPlugin.inferImplements(fp);
    expect(result).toContain("SomeInterface");
  });

  it("returns empty array for file with no classes", () => {
    const fp = path.join(tmpDir, "no_class.py");
    writeFileSync(fp, "x = 42\n", "utf-8");
    const result = pythonPlugin.inferImplements(fp);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Python discovery
// ---------------------------------------------------------------------------

describe("Python discovery", () => {
  it("uses CHEM_PYTHON env var when set", () => {
    const original = process.env["CHEM_PYTHON"];
    try {
      process.env["CHEM_PYTHON"] = "/usr/bin/custom-python";
      expect(discoverPython()).toBe("/usr/bin/custom-python");
    } finally {
      if (original !== undefined) {
        process.env["CHEM_PYTHON"] = original;
      } else {
        delete process.env["CHEM_PYTHON"];
      }
    }
  });

  it("falls back to python3 when CHEM_PYTHON is not set", () => {
    const original = process.env["CHEM_PYTHON"];
    try {
      delete process.env["CHEM_PYTHON"];
      expect(discoverPython()).toBe("python3");
    } finally {
      if (original !== undefined) {
        process.env["CHEM_PYTHON"] = original;
      } else {
        delete process.env["CHEM_PYTHON"];
      }
    }
  });
});

// ---------------------------------------------------------------------------
// formatImportStatement
// ---------------------------------------------------------------------------

describe("formatImportStatement", () => {
  it("formats a regular import", () => {
    const result = pythonPlugin.formatImportStatement(
      "os.path",
      "join",
      false,
    );
    expect(result).toBe("from os.path import join");
  });

  it("formats a TYPE_CHECKING import", () => {
    const result = pythonPlugin.formatImportStatement(
      ".models",
      "User",
      true,
    );
    expect(result).toContain("TYPE_CHECKING");
    expect(result).toContain("from .models import User");
  });
});

// ---------------------------------------------------------------------------
// generateClaudeMd
// ---------------------------------------------------------------------------

describe("generateClaudeMd", () => {
  it("generates CLAUDE.md with Python conventions", () => {
    const md = pythonPlugin.generateClaudeMd("my-project");
    expect(md).toContain("my-project");
    expect(md).toContain("__init__.py");
    expect(md).toContain("dataclass");
    expect(md).toContain("ABC");
    expect(md).toContain("pytest");
    expect(md).toContain("snake_case");
  });
});

// ---------------------------------------------------------------------------
// resolveModulePath (requires filesystem)
// ---------------------------------------------------------------------------

describeIfPython("resolveModulePath", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "chem-python-resolve-"));
    // Create a package structure
    mkdirSync(path.join(tmpDir, "pkg"), { recursive: true });
    mkdirSync(path.join(tmpDir, "pkg", "sub"), { recursive: true });
    writeFileSync(path.join(tmpDir, "pkg", "__init__.py"), "", "utf-8");
    writeFileSync(path.join(tmpDir, "pkg", "module_a.py"), "x = 1\n", "utf-8");
    writeFileSync(path.join(tmpDir, "pkg", "sub", "__init__.py"), "", "utf-8");
    writeFileSync(
      path.join(tmpDir, "pkg", "sub", "module_b.py"),
      "y = 2\n",
      "utf-8",
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves relative .module_a from sibling file", () => {
    const fromFile = path.join(tmpDir, "pkg", "other.py");
    const resolved = pythonPlugin.resolveModulePath(fromFile, ".module_a");
    expect(resolved).toBe(path.join(tmpDir, "pkg", "module_a.py"));
  });

  it("resolves relative ..pkg from sub-package file", () => {
    const fromFile = path.join(tmpDir, "pkg", "sub", "module_b.py");
    const resolved = pythonPlugin.resolveModulePath(fromFile, "..module_a");
    expect(resolved).toBe(path.join(tmpDir, "pkg", "module_a.py"));
  });

  it("returns undefined for stdlib modules", () => {
    const fromFile = path.join(tmpDir, "pkg", "other.py");
    const resolved = pythonPlugin.resolveModulePath(fromFile, "os");
    expect(resolved).toBeUndefined();
  });

  it("resolves '.' to __init__.py", () => {
    const fromFile = path.join(tmpDir, "pkg", "other.py");
    const resolved = pythonPlugin.resolveModulePath(fromFile, ".");
    expect(resolved).toBe(path.join(tmpDir, "pkg", "__init__.py"));
  });
});

// ---------------------------------------------------------------------------
// Assay stub generation
// ---------------------------------------------------------------------------

describeIfPython("generateAssayStub", () => {
  it("generates valid pytest test file", () => {
    const assay = {
      name: "test_orders",
      file: "test_orders.py",
      subjects: ["OrderId", "CreateOrder"],
    };
    const compound = {
      manifest: {
        compound: "orders",
      },
      dir: "/tmp/orders",
    };
    const stub = pythonPlugin.generateAssayStub(assay, compound);
    expect(stub).toContain("import pytest");
    expect(stub).toContain("def test_order_id");
    expect(stub).toContain("def test_create_order");

    // Verify syntax validity
    const pythonPath = discoverPython();
    const checkScript = `
import ast, sys
code = sys.stdin.read()
try:
    ast.parse(code)
    print("OK")
except SyntaxError as e:
    print(f"SYNTAX_ERROR: {e}")
    sys.exit(1)
`;
    const result = execFileSync(pythonPath, ["-c", checkScript], {
      input: stub,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(result.trim()).toBe("OK");
  });
});

// ---------------------------------------------------------------------------
// inferUnits
// ---------------------------------------------------------------------------

describe("inferUnits", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "chem-python-infer-"));
    mkdirSync(path.join(tmpDir, "elements"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "elements", "user_id.py"),
      `class UserId:\n    pass\n`,
      "utf-8",
    );
    writeFileSync(
      path.join(tmpDir, "elements", "email.py"),
      `class Email:\n    pass\n`,
      "utf-8",
    );
    writeFileSync(
      path.join(tmpDir, "elements", "__init__.py"),
      "",
      "utf-8",
    );
    writeFileSync(
      path.join(tmpDir, "elements", "test_user_id.py"),
      "# test file\n",
      "utf-8",
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("infers units from directory, skipping __init__.py and test files", () => {
    const units = pythonPlugin.inferUnits(tmpDir, "elements", "element");
    const names = units.map((u) => u.name);
    expect(names).toContain("Email");
    expect(names).toContain("UserId");
    expect(names).not.toContain("__init__");
    expect(names).not.toContain("TestUserId");
    expect(units.every((u) => u.role === "element")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Timeout verification (structural, no Python needed)
// ---------------------------------------------------------------------------

describe("execFileSync timeout", () => {
  it("parser module uses 30-second timeout in parseImportsBatch", async () => {
    // We verify the timeout is set by reading the source
    const { readFileSync } = await import("node:fs");
    const parserSource = readFileSync(
      path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        "../../plugins/python/parser.ts",
      ),
      "utf-8",
    );
    expect(parserSource).toContain("timeout: 30_000");
  });
});
