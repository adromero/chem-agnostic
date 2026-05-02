// ---------------------------------------------------------------------------
// Unit tests for the .bak helper.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { backupExists, restoreFromBackup, writeBackupOnce } from "../../src/installers/_backup.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-bak-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("writeBackupOnce", () => {
  it("creates <path>.bak on first call", () => {
    const target = path.join(tmpDir, "settings.json");
    fs.writeFileSync(target, "{}");
    expect(writeBackupOnce(target)).toBe(true);
    expect(fs.existsSync(`${target}.bak`)).toBe(true);
  });

  it("does not overwrite an existing .bak on subsequent calls", () => {
    const target = path.join(tmpDir, "settings.json");
    fs.writeFileSync(target, '{"v":1}');
    writeBackupOnce(target);
    fs.writeFileSync(target, '{"v":2}');
    // Second call must NOT overwrite the original .bak.
    expect(writeBackupOnce(target)).toBe(false);
    expect(fs.readFileSync(`${target}.bak`, "utf-8")).toBe('{"v":1}');
  });

  it("returns false when the source file does not exist", () => {
    expect(writeBackupOnce(path.join(tmpDir, "missing.json"))).toBe(false);
  });
});

describe("restoreFromBackup", () => {
  it("copies <path>.bak back over <path>", () => {
    const target = path.join(tmpDir, "settings.json");
    fs.writeFileSync(target, '{"v":1}');
    writeBackupOnce(target);
    fs.writeFileSync(target, '{"v":2}');
    expect(restoreFromBackup(target)).toBe(true);
    expect(fs.readFileSync(target, "utf-8")).toBe('{"v":1}');
  });

  it("returns false when no .bak exists", () => {
    expect(restoreFromBackup(path.join(tmpDir, "nope.json"))).toBe(false);
  });
});

describe("backupExists", () => {
  it("reflects .bak presence", () => {
    const target = path.join(tmpDir, "settings.json");
    fs.writeFileSync(target, "{}");
    expect(backupExists(target)).toBe(false);
    writeBackupOnce(target);
    expect(backupExists(target)).toBe(true);
  });
});
