// ---------------------------------------------------------------------------
// CI guard: assert that `packages/cli/src/version.ts` (committed) matches
// `packages/cli/package.json#version`. The build script regenerates the
// committed file via `npm run build:version`; this test catches drift between
// commits and `npm version <bump>` runs.
// ---------------------------------------------------------------------------
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, "..", "package.json");

describe("packages/cli/src/version.ts CI guard", () => {
  it("VERSION equals packages/cli/package.json#version", () => {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    expect(typeof pkg.version).toBe("string");
    expect(VERSION).toBe(pkg.version);
  });

  it("VERSION is semver-shaped (x.y.z, optionally with -prerelease)", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/);
  });
});
