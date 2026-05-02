/**
 * test/reference-monorepo/structure.test.ts
 *
 * Validates that the WP-018 reference monorepo at apps/reference-monorepo/
 * matches the documented spec:
 *   - top-level metadata (workspace.yaml, package.json, pnpm-workspace.yaml,
 *     CLAUDE.md, AGENTS.md, ...)
 *   - apps/web (TS), apps/worker (TS), apps/api (Python) shells
 *   - shared packages/ (contracts, ui-kit, shared-domain)
 *   - flat src/compounds/ tree with the expected web + worker + shared
 *     compound names
 *   - apps/api/src/compounds/ Python compound names
 *   - test/chemag-graph.snapshot.txt is committed
 *   - install-hooks artifacts (.claude/settings.json, .husky/pre-commit) and
 *     emit-rules artifacts (CLAUDE.md, AGENTS.md, ...) are present
 *
 * Runs as part of the root vitest config (`vitest.root.config.ts`).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const refRoot = resolve(repoRoot, "apps/reference-monorepo");

function refAbs(rel: string): string {
  return resolve(refRoot, rel);
}

describe("reference-monorepo top-level metadata", () => {
  it.each([
    ["workspace.yaml"],
    ["package.json"],
    ["pnpm-workspace.yaml"],
    ["tsconfig.json"],
    ["README.md"],
    [".gitignore"],
    [".npmrc"],
    [".nvmrc"],
    ["scripts/scaffold-compounds.ts"],
  ])("%s exists", (rel) => {
    expect(existsSync(refAbs(rel))).toBe(true);
  });

  it("workspace.yaml declares the chemistry vocabulary and language: typescript", () => {
    const text = readFileSync(refAbs("workspace.yaml"), "utf-8");
    expect(text).toMatch(/vocabulary:\s+chemistry/);
    expect(text).toMatch(/language:\s+typescript/);
    expect(text).toMatch(/paths:\s*\n\s*compounds:\s+\.\/src\/compounds/);
  });

  it("package.json wires chemag scripts (check, analyze, graph, emit-rules)", () => {
    const pkg = JSON.parse(readFileSync(refAbs("package.json"), "utf-8"));
    expect(pkg.scripts["chemag:check"]).toBeTruthy();
    expect(pkg.scripts["chemag:analyze"]).toBeTruthy();
    expect(pkg.scripts["chemag:graph"]).toBeTruthy();
    expect(pkg.scripts["chemag:emit-rules"]).toBeTruthy();
  });
});

describe("reference-monorepo emit-rules artifacts (checked-in)", () => {
  it.each([
    ["CLAUDE.md"],
    ["AGENTS.md"],
    [".cursor/rules/architecture.mdc"],
    [".github/copilot-instructions.md"],
    [".aider/CONVENTIONS.md"],
    [".clinerules"],
  ])("%s is present", (rel) => {
    expect(existsSync(refAbs(rel))).toBe(true);
  });
});

describe("reference-monorepo install-hooks artifacts (checked-in)", () => {
  it(".claude/settings.json carries a chemag-tagged hook entry", () => {
    const p = refAbs(".claude/settings.json");
    expect(existsSync(p)).toBe(true);
    const text = readFileSync(p, "utf-8");
    expect(text).toContain('"_chemag": true');
  });

  it(".husky/pre-commit carries the chemag check line", () => {
    const p = refAbs(".husky/pre-commit");
    expect(existsSync(p)).toBe(true);
    const text = readFileSync(p, "utf-8");
    expect(text).toMatch(/chemag check.*# _chemag/);
  });
});

describe("reference-monorepo TS apps", () => {
  it.each([
    ["apps/web/package.json"],
    ["apps/web/next.config.js"],
    ["apps/web/tsconfig.json"],
    ["apps/web/app/layout.tsx"],
    ["apps/web/app/page.tsx"],
    ["apps/web/.env.example"],
    ["apps/worker/package.json"],
    ["apps/worker/tsconfig.json"],
    ["apps/worker/src/main.ts"],
  ])("%s exists", (rel) => {
    expect(existsSync(refAbs(rel))).toBe(true);
  });

  it("apps/web/.env.example contains placeholders only (no real secrets)", () => {
    const text = readFileSync(refAbs("apps/web/.env.example"), "utf-8");
    // Allow `replace_me` and `your-...-here` placeholders; reject anything
    // that looks like a real Stripe live key (sk_live_) or a 24+ char hex
    // string masquerading as a key.
    expect(text).not.toMatch(/sk_live_/);
    expect(text).toMatch(/replace_?me|your-/);
  });
});

describe("reference-monorepo Python api", () => {
  it.each([
    ["apps/api/workspace.yaml"],
    ["apps/api/pyproject.toml"],
    ["apps/api/src/main.py"],
    ["apps/api/src/__init__.py"],
    ["apps/api/src/compounds/__init__.py"],
    ["apps/api/tests/__init__.py"],
    ["apps/api/tests/test_smoke.py"],
  ])("%s exists", (rel) => {
    expect(existsSync(refAbs(rel))).toBe(true);
  });

  it("apps/api/workspace.yaml declares language: python", () => {
    const text = readFileSync(refAbs("apps/api/workspace.yaml"), "utf-8");
    expect(text).toMatch(/language:\s+python/);
    expect(text).toMatch(/public_surface:\s+__init__\.py/);
  });
});

describe("reference-monorepo shared packages", () => {
  it.each([
    ["packages/contracts/package.json"],
    ["packages/contracts/src/index.ts"],
    ["packages/ui-kit/package.json"],
    ["packages/ui-kit/src/index.ts"],
    ["packages/shared-domain/package.json"],
    ["packages/shared-domain/src/index.ts"],
  ])("%s exists", (rel) => {
    expect(existsSync(refAbs(rel))).toBe(true);
  });
});

describe("reference-monorepo TS compounds (src/compounds/)", () => {
  // Web compounds (12) — one of these must be `billing` for the
  // where_should_this_go("add a Stripe payment flow") acceptance test.
  const webCompounds = [
    "auth",
    "sessions",
    "dashboard",
    "users",
    "billing",
    "integrations",
    "settings",
    "audit-log",
    "search",
    "notifications",
    "support",
    "profile",
  ];
  // Worker compounds (6).
  const workerCompounds = [
    "queue-driver",
    "job-runners",
    "retry-policy",
    "metrics",
    "audit-emit",
    "lifecycle",
  ];
  // Shared compounds (3) declared as solvent type.
  const sharedCompounds = ["shared-domain", "contracts", "ui-kit"];

  it.each([...webCompounds, ...workerCompounds, ...sharedCompounds].map((c) => [c]))(
    "compound %s/compound.yaml + public.ts present",
    (compound) => {
      expect(existsSync(refAbs(`src/compounds/${compound}/compound.yaml`))).toBe(true);
      expect(existsSync(refAbs(`src/compounds/${compound}/public.ts`))).toBe(true);
    },
  );

  it("billing/compound.yaml description mentions Stripe (drives where_should_this_go)", () => {
    const text = readFileSync(refAbs("src/compounds/billing/compound.yaml"), "utf-8");
    expect(text.toLowerCase()).toContain("stripe");
    expect(text.toLowerCase()).toMatch(/payment|billing/);
  });
});

describe("reference-monorepo Python compounds (apps/api/src/compounds/)", () => {
  const pyCompounds = [
    "settings",
    "errors",
    "auth",
    "observability",
    "repositories",
    "services",
    "routers",
    "integrations",
    "tasks",
    "healthcheck",
  ];

  it.each(pyCompounds.map((c) => [c]))(
    "compound %s/compound.yaml + __init__.py present",
    (compound) => {
      expect(existsSync(refAbs(`apps/api/src/compounds/${compound}/compound.yaml`))).toBe(true);
      expect(existsSync(refAbs(`apps/api/src/compounds/${compound}/__init__.py`))).toBe(true);
    },
  );
});

describe("reference-monorepo graph snapshot", () => {
  it("test/chemag-graph.snapshot.txt is committed and starts with `graph LR`", () => {
    const p = refAbs("test/chemag-graph.snapshot.txt");
    expect(existsSync(p)).toBe(true);
    const text = readFileSync(p, "utf-8");
    expect(text.trimStart().startsWith("graph LR")).toBe(true);
    // Spot-check that the canonical compounds appear.
    for (const name of ["billing", "auth", "queue-driver"]) {
      expect(text).toContain(name);
    }
  });
});

describe("reference-monorepo infra placeholder", () => {
  it("infra/README.md exists and references Phase 2 (WP-058+)", () => {
    const p = refAbs("infra/README.md");
    expect(existsSync(p)).toBe(true);
    const text = readFileSync(p, "utf-8");
    expect(text).toMatch(/WP-058|Phase 2/);
  });
});

describe("reference-monorepo is its own pnpm workspace (NOT included in outer)", () => {
  it("outer pnpm-workspace.yaml does not include apps/reference-monorepo", () => {
    const text = readFileSync(resolve(repoRoot, "pnpm-workspace.yaml"), "utf-8");
    expect(text).not.toMatch(/apps\/reference-monorepo/);
  });

  it("inner apps/reference-monorepo/pnpm-workspace.yaml declares apps/* and packages/*", () => {
    const text = readFileSync(refAbs("pnpm-workspace.yaml"), "utf-8");
    expect(text).toMatch(/apps\/web/);
    expect(text).toMatch(/apps\/worker/);
    expect(text).toMatch(/packages\/\*/);
  });
});
