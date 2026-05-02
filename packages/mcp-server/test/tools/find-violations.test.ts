// ---------------------------------------------------------------------------
// `find_violations` tool tests.
//
// Test criterion #8 in the spec: with `since: HEAD~1` against a tmp git repo
// containing a deliberately-broken commit on top of a clean baseline, the
// tool returns the introduced violation only.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import { findViolationsTool } from "../../src/tools/find-violations.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-fv-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("find_violations — clean workspace", () => {
  it("returns 0 diagnostics for the clean sample fixture", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await findViolationsTool.handler({}, session);
    expect(out.total).toBe(0);
    expect(out.diagnostics).toEqual([]);
    expect(out.truncated).toBe(false);
  });
});

describe("find_violations — compound filter", () => {
  it("returns only diagnostics for the named compound", async () => {
    // No diagnostics in the sample, so we can't exercise the filter
    // beyond confirming the empty result remains stable.
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await findViolationsTool.handler({ compound: "payments" }, session);
    expect(out.diagnostics).toEqual([]);
  });
});

describe("find_violations — `since` filter against a real git repo", () => {
  it("returns only violations introduced in changed files", async () => {
    let gitAvailable = true;
    try {
      execFileSync("git", ["--version"], { stdio: "ignore" });
    } catch {
      gitAvailable = false;
    }
    if (!gitAvailable) return;

    // Build a self-contained temp workspace seeded from the sample fixture.
    const wsDir = path.join(tmpRoot, "ws");
    fs.cpSync(SAMPLE, wsDir, { recursive: true });

    const git = (...args: string[]): void => {
      execFileSync("git", args, { cwd: wsDir, stdio: "ignore" });
    };
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("config", "commit.gpgsign", "false");
    git("add", ".");
    git("commit", "-q", "-m", "baseline");

    // Introduce a violation: make Money import StripeGateway (an adapter).
    // value-object can only depend on value-object, so this is CHEM-BOND-003.
    const moneyPath = path.join(wsDir, "src/compounds/payments/elements/Money.ts");
    const before = fs.readFileSync(moneyPath, "utf-8");
    fs.writeFileSync(
      moneyPath,
      `import { StripeGateway } from "../adapters/StripeGateway.ts";\n${before}\nexport const dummy = StripeGateway;\n`,
      "utf-8",
    );
    git("add", ".");
    git("commit", "-q", "-m", "break");

    const session = new Session({ workspaceDir: wsDir });

    // Without `since`, the violation is in the unchanged, fully-tracked
    // workspace — reachable via baseline analysis.
    const all = await findViolationsTool.handler({}, session);
    expect(all.total).toBeGreaterThanOrEqual(1);
    const allCodes = new Set(all.diagnostics.map((d) => d.code));
    expect(allCodes.has("CHEM-BOND-003")).toBe(true);

    // With `since: HEAD~1`, the changed-files filter keeps only diagnostics
    // whose `file` is in the diff. The introduced violation lives in
    // Money.ts which is the only file changed in HEAD.
    const withSince = await findViolationsTool.handler({ since: "HEAD~1" }, session);
    expect(withSince.total).toBeGreaterThanOrEqual(1);
    for (const d of withSince.diagnostics) {
      expect(d.file).toBeDefined();
      expect(path.basename(d.file as string)).toBe("Money.ts");
    }
  });
});
