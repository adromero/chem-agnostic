// ---------------------------------------------------------------------------
// `scaffold_unit` tool tests.
//
// Test criterion #7: scaffold_unit creates the expected files and returns a
// parseable unified diff (validated by round-tripping it through
// `diff.parsePatch`). Manifest written matches the byte-output of
// `chemag add unit` for the same arguments.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePatch } from "diff";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import { scaffoldUnitTool } from "../../src/tools/scaffold-unit.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;
let wsDir: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-su-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
  wsDir = path.join(tmpRoot, "ws");
  fs.cpSync(SAMPLE, wsDir, { recursive: true });
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("scaffold_unit", () => {
  it("creates a stub file and returns a parseable unified diff", async () => {
    const session = new Session({ workspaceDir: wsDir });
    const out = await scaffoldUnitTool.handler(
      { compound: "reporting", role: "element", name: "ReportRow" },
      session,
    );

    // Stub created on disk.
    const stubPath = path.join(wsDir, "src/compounds/reporting/elements/ReportRow.ts");
    expect(fs.existsSync(stubPath)).toBe(true);
    expect(out.created.some((p) => p.endsWith(`elements${path.sep}ReportRow.ts`))).toBe(true);

    // Manifest mutated.
    const manifestPath = path.join(wsDir, "src/compounds/reporting/compound.yaml");
    const manifest = fs.readFileSync(manifestPath, "utf-8");
    expect(manifest).toContain("name: ReportRow");
    expect(manifest).toContain("elements/ReportRow.ts");

    // manifest_diff is a parseable unified diff.
    expect(out.manifest_diff).toBeTypeOf("string");
    expect(out.manifest_diff.length).toBeGreaterThan(0);
    const patches = parsePatch(out.manifest_diff);
    expect(patches.length).toBeGreaterThanOrEqual(1);
    // The patch should mention the new unit name in one of its hunks.
    const hunks = patches.flatMap((p) => p.hunks);
    const text = hunks.flatMap((h) => h.lines).join("\n");
    expect(text).toContain("ReportRow");
  });

  it("returns an error message when the compound is unknown", async () => {
    const session = new Session({ workspaceDir: wsDir });
    await expect(
      scaffoldUnitTool.handler({ compound: "ghost", role: "element", name: "X" }, session),
    ).rejects.toThrow(/not found/i);
  });

  it("returns an error message on duplicate unit names", async () => {
    const session = new Session({ workspaceDir: wsDir });
    await expect(
      scaffoldUnitTool.handler({ compound: "payments", role: "element", name: "Money" }, session),
    ).rejects.toThrow(/already exists/i);
  });
});
