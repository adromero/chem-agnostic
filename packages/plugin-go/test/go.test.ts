import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { goPlugin } from "../src/index.js";
import {
  generateAssayStub,
  generateClaudeMd,
  generatePublicSurface,
  generateUnitStub,
  packageNameForFolder,
  toSnakeCase,
} from "../src/generator.js";
import { discoverHelperBinary } from "../src/parser.js";
import type {
  AssayDeclaration,
  LoadedCompound,
  ResolvedImport,
  UnitDeclaration,
  Workspace,
} from "@chemag/core/types";

// ---------------------------------------------------------------------------
// Helper-binary availability gate
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const helperSrc = path.join(pkgRoot, "go-helper");

function hasGoToolchain(): boolean {
  try {
    execSync("go version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const goAvailable = hasGoToolchain();

// Build the helper ad-hoc into a temp directory if `go` exists. The
// binary then drives the CHEMAG_GO_HELPER env var so parser.ts picks it
// up regardless of whether prebuilt platform binaries are bundled.
let adhocHelper: string | undefined;
let adhocCleanup: (() => void) | undefined;

beforeAll(() => {
  if (!goAvailable) return;
  const dir = mkdtempSync(path.join(tmpdir(), "chemag-go-helper-build-"));
  const out = path.join(dir, process.platform === "win32" ? "helper.exe" : "helper");
  const result = spawnSync("go", ["build", "-o", out, "."], {
    cwd: helperSrc,
    encoding: "utf-8",
    timeout: 120_000,
  });
  if (result.status === 0) {
    adhocHelper = out;
    process.env.CHEMAG_GO_HELPER = out;
    adhocCleanup = () => {
      delete process.env.CHEMAG_GO_HELPER;
      rmSync(dir, { recursive: true, force: true });
    };
  } else {
    rmSync(dir, { recursive: true, force: true });
  }
});

afterAll(() => {
  adhocCleanup?.();
});

const helperReady = (): boolean => Boolean(adhocHelper) || Boolean(discoverHelperBinary());
const describeIfHelper = (name: string, fn: () => void) => {
  if (!helperReady() && !goAvailable) {
    describe.skip(name, fn);
  } else {
    describe(name, fn);
  }
};

// ---------------------------------------------------------------------------
// Plugin metadata (no helper needed)
// ---------------------------------------------------------------------------

describe("goPlugin basics", () => {
  it("has correct name and extensions", () => {
    expect(goPlugin.name).toBe("go");
    expect(goPlugin.fileExtensions).toEqual([".go"]);
  });

  it("has correct defaults", () => {
    expect(goPlugin.defaults.publicSurface).toBe("public.go");
    expect(goPlugin.defaults.testFilePattern).toEqual(/_test\.go$/);
    expect(goPlugin.defaults.testFrameworkImport).toBe("testing");
  });

  it("isSourceFile accepts plain .go files", () => {
    expect(goPlugin.isSourceFile("user_id.go")).toBe(true);
    expect(goPlugin.isSourceFile("public.go")).toBe(true);
  });

  it("isSourceFile rejects _test.go files", () => {
    expect(goPlugin.isSourceFile("user_id_test.go")).toBe(false);
  });

  it("isSourceFile rejects non-.go files", () => {
    expect(goPlugin.isSourceFile("module.ts")).toBe(false);
    expect(goPlugin.isSourceFile("README.md")).toBe(false);
  });

  it("unitFilePath produces snake_case .go path", () => {
    expect(goPlugin.unitFilePath("element", "UserId", "elements")).toBe("elements/user_id.go");
    expect(goPlugin.unitFilePath("interface", "OrderRepo", "interface")).toBe(
      "interface/order_repo.go",
    );
    expect(goPlugin.unitFilePath("adapter", "PgOrderRepo", "adapter")).toBe(
      "adapter/pg_order_repo.go",
    );
  });
});

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

describe("toSnakeCase", () => {
  it("converts UserId to user_id", () => {
    expect(toSnakeCase("UserId")).toBe("user_id");
  });

  it("converts PgOrderRepo to pg_order_repo", () => {
    expect(toSnakeCase("PgOrderRepo")).toBe("pg_order_repo");
  });

  it("converts HTTPServer to http_server", () => {
    expect(toSnakeCase("HTTPServer")).toBe("http_server");
  });
});

describe("packageNameForFolder", () => {
  it("maps `interface` to `iface`", () => {
    expect(packageNameForFolder("interface")).toBe("iface");
    expect(packageNameForFolder("interfaces")).toBe("iface");
  });

  it("lowercases other folders verbatim", () => {
    expect(packageNameForFolder("element")).toBe("element");
    expect(packageNameForFolder("Adapter")).toBe("adapter");
    expect(packageNameForFolder("compounds/orders/element")).toBe("element");
  });
});

// ---------------------------------------------------------------------------
// Stub generation snapshots (no helper needed)
// ---------------------------------------------------------------------------

describe("generateUnitStub", () => {
  const noImports: ResolvedImport[] = [];

  it("element/UserId → elements/user_id.go with package element", () => {
    const unit: UnitDeclaration = {
      role: "element",
      name: "UserId",
      file: path.join("elements", "user_id.go"),
    };
    const code = generateUnitStub(unit, noImports);
    expect(code).toContain("package element");
    expect(code).toContain("type UserId struct");
    expect(code).toContain("func NewUserId");
  });

  it("interface/OrderRepo → interface/order_repo.go with package iface", () => {
    const unit: UnitDeclaration = {
      role: "interface",
      name: "OrderRepo",
      file: path.join("interface", "order_repo.go"),
    };
    const code = generateUnitStub(unit, noImports);
    expect(code).toContain("package iface");
    expect(code).toContain("type OrderRepo interface");
  });

  it("adapter/PgOrderRepo → adapter/pg_order_repo.go with implements method", () => {
    const unit: UnitDeclaration = {
      role: "adapter",
      name: "PgOrderRepo",
      file: path.join("adapter", "pg_order_repo.go"),
      implements: ["OrderRepo"],
    };
    const code = generateUnitStub(unit, noImports);
    expect(code).toContain("package adapter");
    expect(code).toContain("type PgOrderRepo struct");
    expect(code).toContain("func (a *PgOrderRepo) Execute() error");
  });

  it("reaction stub uses func returning error", () => {
    const unit: UnitDeclaration = {
      role: "reaction",
      name: "CreateOrder",
      file: path.join("reactions", "create_order.go"),
    };
    const code = generateUnitStub(unit, noImports);
    expect(code).toContain("package reactions");
    expect(code).toContain("func CreateOrder() error");
  });

  it("buffer stub wraps next func", () => {
    const unit: UnitDeclaration = {
      role: "buffer",
      name: "Logging",
      file: path.join("buffers", "logging.go"),
    };
    const code = generateUnitStub(unit, noImports);
    expect(code).toContain("package buffers");
    expect(code).toContain("func Logging(next func() error)");
  });

  it("renders an import block when imports are supplied", () => {
    const unit: UnitDeclaration = {
      role: "molecule",
      name: "Order",
      file: path.join("molecules", "order.go"),
    };
    const imports: ResolvedImport[] = [
      {
        fromCompound: "example.com/app/orders/elements",
        fromUnit: "OrderId",
        names: ["OrderId"],
        isTypeOnly: false,
      },
    ];
    const code = generateUnitStub(unit, imports);
    expect(code).toContain("package molecules");
    expect(code).toContain('"example.com/app/orders/elements"');
  });
});

// ---------------------------------------------------------------------------
// Public-surface snapshot
// ---------------------------------------------------------------------------

describe("generatePublicSurface", () => {
  it("emits type aliases for type roles and var aliases for value roles", () => {
    const compound: LoadedCompound = {
      manifest: {
        compound: "orders",
        exports: {
          element: ["OrderId"],
          interface: ["OrderRepo"],
          reaction: ["CreateOrder"],
        },
      },
      dir: "/tmp/orders",
    } as LoadedCompound;
    const workspace: Workspace = {
      workspace: "demo",
      language: "go",
      roles: {
        element: { description: "Value", folder: "element" },
        interface: { description: "Port", folder: "interface" },
        reaction: { description: "Workflow", folder: "reactions" },
      },
      bonds: {},
      paths: { compounds: "src/compounds" },
    } as unknown as Workspace;

    const result = generatePublicSurface(compound, workspace);
    expect(result).toContain("package orders");
    // Inner package import lines (the absolute import path falls back to
    // the compound name because no go.mod is present at /tmp/orders).
    expect(result).toContain("orders/element");
    expect(result).toContain('iface "orders/interface"');
    expect(result).toContain("type OrderId = element.OrderId");
    expect(result).toContain("type OrderRepo = iface.OrderRepo");
    expect(result).toContain("var CreateOrder = reactions.CreateOrder");
  });

  it("emits a minimal stub when the compound has no exports", () => {
    const compound: LoadedCompound = {
      manifest: { compound: "empty" },
      dir: "/tmp/empty",
    } as LoadedCompound;
    const workspace: Workspace = {
      workspace: "demo",
      language: "go",
      roles: {},
      bonds: {},
      paths: { compounds: "src/compounds" },
    } as unknown as Workspace;
    const result = generatePublicSurface(compound, workspace);
    expect(result).toContain("package empty");
  });
});

// ---------------------------------------------------------------------------
// Assay generation snapshot
// ---------------------------------------------------------------------------

describe("generateAssayStub", () => {
  it("emits a `_test` package with one Test func per subject", () => {
    const assay: AssayDeclaration = {
      name: "orders_test",
      file: "orders_test.go",
      subjects: ["OrderId", "CreateOrder"],
    };
    const compound: LoadedCompound = {
      manifest: { compound: "orders" },
      dir: "/tmp/orders",
    } as LoadedCompound;
    const stub = generateAssayStub(assay, compound);
    expect(stub).toContain("package orders_test");
    expect(stub).toContain("func TestOrderId(t *testing.T)");
    expect(stub).toContain("func TestCreateOrder(t *testing.T)");
  });
});

// ---------------------------------------------------------------------------
// CLAUDE.md section
// ---------------------------------------------------------------------------

describe("generateClaudeMd", () => {
  it("emits the Go language section with key conventions", () => {
    const md = generateClaudeMd("demo");
    expect(md).toContain("## Language: Go");
    expect(md).toContain("snake_case.go");
    expect(md).toContain("public.go");
    expect(md).toContain("iface");
    expect(md).toContain("testing");
  });
});

// ---------------------------------------------------------------------------
// formatImportStatement
// ---------------------------------------------------------------------------

describe("formatImportStatement", () => {
  it("renders a plain Go import", () => {
    expect(goPlugin.formatImportStatement("fmt", "Println", false)).toBe('import "fmt"');
  });

  it("preserves type-only intent in a leading comment", () => {
    const out = goPlugin.formatImportStatement("example.com/types", "Foo", true);
    expect(out).toContain("type-only");
    expect(out).toContain('import "example.com/types"');
  });
});

// ---------------------------------------------------------------------------
// Helper-binary smoke test (skips cleanly when neither the prebuilt binary
// nor a Go toolchain is available — same gating pattern as the Python plugin)
// ---------------------------------------------------------------------------

describeIfHelper("parseImports (helper binary required)", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "chem-go-test-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeGo(name: string, content: string): string {
    const fp = path.join(tmpDir, name);
    mkdirSync(path.dirname(fp), { recursive: true });
    writeFileSync(fp, content, "utf-8");
    return fp;
  }

  it("parses standard-library imports", () => {
    const fp = writeGo(
      "imports.go",
      `package demo

import (
\t"fmt"
\t"strings"
)

func Hello() {
\tfmt.Println(strings.ToLower("HI"))
}
`,
    );
    const imports = goPlugin.parseImports(fp);
    const specs = imports.map((i) => i.moduleSpecifier).sort();
    expect(specs).toEqual(["fmt", "strings"]);
    for (const imp of imports) {
      expect(imp.isTypeOnly).toBe(false);
      expect(imp.names.length).toBeGreaterThan(0);
    }
  });

  it("parses aliased and dotted imports", () => {
    const fp = writeGo(
      "aliased.go",
      `package demo

import (
\tf "fmt"
\t"example.com/foo/bar"
)

var _ = f.Sprintf
var _ = bar.Anything
`,
    );
    const imports = goPlugin.parseImports(fp);
    const aliased = imports.find((i) => i.moduleSpecifier === "fmt");
    const dotted = imports.find((i) => i.moduleSpecifier === "example.com/foo/bar");
    expect(aliased?.names).toEqual(["f"]);
    expect(dotted?.names).toEqual(["bar"]);
  });
});

// ---------------------------------------------------------------------------
// Module resolution (works without the helper because it only reads go.mod)
// ---------------------------------------------------------------------------

describe("resolveModulePath / findGoModule", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "chem-go-resolve-"));
    writeFileSync(path.join(tmpDir, "go.mod"), "module example.com/demo\n\ngo 1.22\n", "utf-8");
    mkdirSync(path.join(tmpDir, "elements"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "elements", "user_id.go"),
      "package elements\n\ntype UserId struct{ Value string }\n",
      "utf-8",
    );
    mkdirSync(path.join(tmpDir, "reactions"), { recursive: true });
    writeFileSync(path.join(tmpDir, "reactions", "main.go"), "package reactions\n", "utf-8");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves a same-module import to a concrete .go file", () => {
    const from = path.join(tmpDir, "reactions", "main.go");
    const resolved = goPlugin.resolveModulePath(from, "example.com/demo/elements");
    expect(resolved).toBe(path.join(tmpDir, "elements", "user_id.go"));
  });

  it("returns undefined for stdlib imports", () => {
    const from = path.join(tmpDir, "reactions", "main.go");
    expect(goPlugin.resolveModulePath(from, "fmt")).toBeUndefined();
  });

  it("returns undefined for foreign module imports", () => {
    const from = path.join(tmpDir, "reactions", "main.go");
    expect(goPlugin.resolveModulePath(from, "github.com/foo/bar")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// inferUnits via filesystem (no helper needed — pure-TS implementation)
// ---------------------------------------------------------------------------

describe("inferUnits", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "chem-go-infer-"));
    mkdirSync(path.join(tmpDir, "elements"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "elements", "user_id.go"),
      "package elements\n\ntype UserId struct{ Value string }\n",
      "utf-8",
    );
    writeFileSync(
      path.join(tmpDir, "elements", "order_id.go"),
      "package elements\n\ntype OrderId struct{ Value string }\n",
      "utf-8",
    );
    writeFileSync(
      path.join(tmpDir, "elements", "doc.go"),
      "// Package elements ...\npackage elements\n",
      "utf-8",
    );
    writeFileSync(
      path.join(tmpDir, "elements", "user_id_test.go"),
      "package elements_test\n",
      "utf-8",
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("infers PascalCase unit names from snake_case files; skips _test.go and doc.go", () => {
    const units = goPlugin.inferUnits(tmpDir, "elements", "element");
    const names = units.map((u) => u.name).sort();
    expect(names).toEqual(["OrderId", "UserId"]);
    expect(units.every((u) => u.role === "element")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// inferImplements via helper binary
// ---------------------------------------------------------------------------

describeIfHelper("inferImplements (helper binary required)", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "chem-go-impl-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects an Implements: doc-comment", () => {
    const fp = path.join(tmpDir, "adapter.go");
    writeFileSync(
      fp,
      `package adapter

// PgOrderRepo concrete impl.
// Implements: OrderRepo
type PgOrderRepo struct{}
`,
      "utf-8",
    );
    const result = goPlugin.inferImplements(fp);
    expect(result).toContain("OrderRepo");
  });

  it("detects an embedded interface field", () => {
    const fp = path.join(tmpDir, "embed.go");
    writeFileSync(
      fp,
      `package adapter

type LoggingOrderRepo struct {
\tOrderRepo
\tLogger interface{}
}
`,
      "utf-8",
    );
    const result = goPlugin.inferImplements(fp);
    expect(result).toContain("OrderRepo");
  });
});

// ---------------------------------------------------------------------------
// The bundled helper directory layout matches what parser.ts expects
// ---------------------------------------------------------------------------

describe("bin/ layout contract", () => {
  it("package.json files[] includes bin/**", () => {
    const pkg = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf-8"));
    expect(pkg.files).toContain("bin/**");
  });
});
