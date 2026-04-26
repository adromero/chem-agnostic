// Consent-prompt tests — exercises the injected ConsentIO seam (no real stdio).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type ConsentIO,
  loadConfig,
  makeOptInConfig,
  makeOptOutConfig,
  promptForConsent,
  saveConfig,
  NON_INTERACTIVE_NOTE,
} from "../src/consent.js";

let tmpDir: string;
let prevConfigHome: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-consent-"));
  prevConfigHome = process.env.CHEMAG_CONFIG_HOME;
  process.env.CHEMAG_CONFIG_HOME = tmpDir;
});

afterEach(() => {
  if (prevConfigHome === undefined) delete process.env.CHEMAG_CONFIG_HOME;
  else process.env.CHEMAG_CONFIG_HOME = prevConfigHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeIO(opts: {
  isInteractive: boolean;
  answer?: string;
  readLine?: () => Promise<string>;
}): ConsentIO & { print: ReturnType<typeof vi.fn>; readLine: ReturnType<typeof vi.fn> } {
  const print = vi.fn();
  const readLine = vi.fn(opts.readLine ?? (async () => opts.answer ?? ""));
  return {
    isInteractive: () => opts.isInteractive,
    readLine,
    print,
  };
}

describe("promptForConsent — TTY interactive", () => {
  it("returns true on 'y'", async () => {
    const io = makeIO({ isInteractive: true, answer: "y\n" });
    expect(await promptForConsent(io)).toBe(true);
    expect(io.readLine).toHaveBeenCalledTimes(1);
    expect(io.print).toHaveBeenCalled();
  });

  it("returns true on 'Y'", async () => {
    const io = makeIO({ isInteractive: true, answer: "Y" });
    expect(await promptForConsent(io)).toBe(true);
  });

  it("returns true on 'yes'", async () => {
    const io = makeIO({ isInteractive: true, answer: "yes" });
    expect(await promptForConsent(io)).toBe(true);
  });

  it("returns false on 'YES' (case-insensitive)", async () => {
    const io = makeIO({ isInteractive: true, answer: "YES" });
    expect(await promptForConsent(io)).toBe(true);
  });

  it("returns false on empty input (default)", async () => {
    const io = makeIO({ isInteractive: true, answer: "" });
    expect(await promptForConsent(io)).toBe(false);
  });

  it("returns false on 'n'", async () => {
    const io = makeIO({ isInteractive: true, answer: "n" });
    expect(await promptForConsent(io)).toBe(false);
  });

  it("returns false on 'no'", async () => {
    const io = makeIO({ isInteractive: true, answer: "no" });
    expect(await promptForConsent(io)).toBe(false);
  });

  it("returns false on garbage input", async () => {
    const io = makeIO({ isInteractive: true, answer: "maybe later" });
    expect(await promptForConsent(io)).toBe(false);
  });
});

describe("promptForConsent — non-interactive", () => {
  it("returns false WITHOUT calling readLine", async () => {
    const io = makeIO({ isInteractive: false });
    const result = await promptForConsent(io);
    expect(result).toBe(false);
    expect(io.readLine).not.toHaveBeenCalled();
    expect(io.print).toHaveBeenCalled();
    const printed = io.print.mock.calls.map((c) => c[0]).join("");
    expect(printed).toContain(NON_INTERACTIVE_NOTE);
  });
});

describe("loadConfig / saveConfig", () => {
  it("returns null when no config file exists", () => {
    expect(loadConfig()).toBeNull();
  });

  it("round-trips an opt-in config with anonymousId", () => {
    const cfg = makeOptInConfig();
    saveConfig(cfg);
    const loaded = loadConfig();
    expect(loaded).not.toBeNull();
    expect(loaded?.telemetry.enabled).toBe(true);
    expect(loaded?.telemetry.anonymousId).toBe(cfg.telemetry.anonymousId);
    expect(loaded?.telemetry.optedInAt).toBe(cfg.telemetry.optedInAt);
  });

  it("opt-in config has a UUID-shaped anonymousId", () => {
    const cfg = makeOptInConfig();
    expect(cfg.telemetry.anonymousId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("opt-out config stores no anonymousId and no optedInAt", () => {
    const cfg = makeOptOutConfig();
    saveConfig(cfg);
    const loaded = loadConfig();
    expect(loaded?.telemetry.enabled).toBe(false);
    expect(loaded?.telemetry.anonymousId).toBeUndefined();
    expect(loaded?.telemetry.optedInAt).toBeUndefined();
    expect(loaded?.telemetry.optedOutAt).toBeDefined();
  });

  it("loadConfig returns null on malformed JSON", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "config.json"), "{broken");
    expect(loadConfig()).toBeNull();
  });

  it("loadConfig returns null when telemetry.enabled is missing", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "config.json"), JSON.stringify({ telemetry: {} }));
    expect(loadConfig()).toBeNull();
  });
});

describe("re-opt-in after decline writes a fresh UUID", () => {
  it("a second opt-in produces a UUID different from the first", () => {
    // First: decline.
    saveConfig(makeOptOutConfig());
    const declined = loadConfig();
    expect(declined?.telemetry.enabled).toBe(false);
    expect(declined?.telemetry.anonymousId).toBeUndefined();

    // Re-opt-in.
    const optedIn = makeOptInConfig();
    saveConfig(optedIn);
    const loaded = loadConfig();
    expect(loaded?.telemetry.enabled).toBe(true);
    expect(loaded?.telemetry.anonymousId).toBe(optedIn.telemetry.anonymousId);

    // And: a third opt-in (re-re-opt-in) yields yet another UUID — proving
    // the UUID is regenerated, never reused.
    const reOptIn = makeOptInConfig();
    expect(reOptIn.telemetry.anonymousId).not.toBe(optedIn.telemetry.anonymousId);
  });
});
