// ---------------------------------------------------------------------------
// Tests for `_husky.ts` — husky detection + .husky/pre-commit line management.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CHEMAG_PRECOMMIT_LINE,
  CHEMAG_TAG,
  PrecommitUnparseableError,
  addChemagLine,
  detectHusky,
  removeChemagLines,
} from "../../src/installers/_husky.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-husky-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectHusky", () => {
  it("returns detected:false for an empty workspace", () => {
    const result = detectHusky(tmpDir);
    expect(result.detected).toBe(false);
    expect(result.huskyDirExists).toBe(false);
    expect(result.dependencyDeclared).toBe(false);
  });

  it("returns detected:true when .husky/ exists", () => {
    fs.mkdirSync(path.join(tmpDir, ".husky"), { recursive: true });
    const result = detectHusky(tmpDir);
    expect(result.detected).toBe(true);
    expect(result.huskyDirExists).toBe(true);
  });

  it("returns detected:true when package.json declares husky in devDependencies", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "x", devDependencies: { husky: "^9.0.0" } }),
    );
    const result = detectHusky(tmpDir);
    expect(result.detected).toBe(true);
    expect(result.dependencyDeclared).toBe(true);
  });

  it("ignores invalid package.json gracefully", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{not json");
    const result = detectHusky(tmpDir);
    expect(result.detected).toBe(false);
    expect(result.dependencyDeclared).toBe(false);
  });
});

describe("addChemagLine", () => {
  it("creates default content when file is absent (existing === null)", () => {
    const result = addChemagLine(null);
    expect(result.changed).toBe(true);
    expect(result.alreadyPresent).toBe(false);
    expect(result.body).toContain(CHEMAG_PRECOMMIT_LINE);
    expect(result.body.startsWith("#!/usr/bin/env sh")).toBe(true);
  });

  it("appends our line when existing file has no chemag tag", () => {
    const existing = "#!/usr/bin/env sh\nlint-staged\n";
    const result = addChemagLine(existing);
    expect(result.changed).toBe(true);
    expect(result.alreadyPresent).toBe(false);
    expect(result.body).toContain("lint-staged");
    expect(result.body).toContain(CHEMAG_PRECOMMIT_LINE);
  });

  it("is idempotent: re-adding produces no diff", () => {
    const a = addChemagLine(null);
    const b = addChemagLine(a.body);
    expect(b.body).toBe(a.body);
    expect(b.changed).toBe(false);
    expect(b.alreadyPresent).toBe(true);
  });

  it("replaces a stale chemag line in place when the user edited the command", () => {
    const stale = `#!/usr/bin/env sh\nchemag check ${CHEMAG_TAG}\n`;
    const result = addChemagLine(stale);
    // It should canonicalize to the current CHEMAG_PRECOMMIT_LINE.
    expect(result.alreadyPresent).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.body).toContain(CHEMAG_PRECOMMIT_LINE);
    // Old (incomplete) command no longer appears.
    expect(result.body).not.toMatch(/^chemag check # _chemag$/m);
  });

  it("throws PrecommitUnparseableError when multiple chemag tags are present", () => {
    const broken = `chemag check ${CHEMAG_TAG}\nchemag analyze ${CHEMAG_TAG}\n`;
    expect(() => addChemagLine(broken)).toThrow(PrecommitUnparseableError);
  });

  it("throws PrecommitUnparseableError when file contains NUL bytes", () => {
    const binary = `\x00binary\x00${CHEMAG_TAG}`;
    expect(() => addChemagLine(binary)).toThrow(PrecommitUnparseableError);
  });

  it("throws PrecommitUnparseableError when chemag tag has no command", () => {
    const malformed = `#!/usr/bin/env sh\n   ${CHEMAG_TAG}\n`;
    expect(() => addChemagLine(malformed)).toThrow(PrecommitUnparseableError);
  });
});

describe("removeChemagLines", () => {
  it("strips a single chemag line, preserves surrounding content", () => {
    const before = `#!/usr/bin/env sh\nlint-staged\n${CHEMAG_PRECOMMIT_LINE}\n`;
    const result = removeChemagLines(before);
    expect(result.changed).toBe(true);
    expect(result.body).not.toBeNull();
    expect(result.body).toContain("lint-staged");
    expect(result.body).not.toContain("# _chemag");
  });

  it("returns body=null when only the shebang would remain", () => {
    const before = `#!/usr/bin/env sh\n${CHEMAG_PRECOMMIT_LINE}\n`;
    const result = removeChemagLines(before);
    expect(result.changed).toBe(true);
    expect(result.body).toBeNull();
  });

  it("returns changed:false when no chemag tag is present", () => {
    const before = "#!/usr/bin/env sh\nlint-staged\n";
    const result = removeChemagLines(before);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(before);
  });

  it("rejects unparseable content (NUL bytes)", () => {
    const broken = `\x00binary\x00${CHEMAG_TAG}`;
    expect(() => removeChemagLines(broken)).toThrow(PrecommitUnparseableError);
  });

  it("strips multiple chemag-tagged lines (idempotent removal)", () => {
    const before = `chemag a ${CHEMAG_TAG}\nchemag b ${CHEMAG_TAG}\nlint-staged\n`;
    const result = removeChemagLines(before);
    expect(result.changed).toBe(true);
    expect(result.body).toContain("lint-staged");
    expect(result.body).not.toContain("# _chemag");
  });
});
