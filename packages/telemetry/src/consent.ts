// ---------------------------------------------------------------------------
// Consent IO and persistent config (~/.config/chemag/config.json).
//
// Exports:
//   - ConsentIO + defaultConsentIO  — injectable seam used by promptForConsent.
//   - promptForConsent              — TTY-aware first-run prompt; non-interactive
//                                     callers receive `false` and never read stdin.
//   - loadConfig / saveConfig       — atomic JSON IO for the persistent file.
//   - getConfigPath / getConfigDir  — XDG-aware path resolvers (override-friendly
//                                     via CHEMAG_CONFIG_HOME for tests).
//
// The TELEMETRY config-shape lives here so the queue/transport modules don't
// duplicate the file IO and so tests can stub at a single boundary.
// ---------------------------------------------------------------------------

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
  unlinkSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as readline from "node:readline";

export interface TelemetryConfig {
  enabled: boolean;
  anonymousId?: string;
  optedInAt?: string;
  optedOutAt?: string;
}

export interface ChemagConfig {
  telemetry: TelemetryConfig;
}

export interface ConsentIO {
  isInteractive: () => boolean;
  readLine: () => Promise<string>;
  print: (s: string) => void;
}

export const defaultConsentIO: ConsentIO = {
  isInteractive: (): boolean => process.stdin.isTTY === true && process.stdout.isTTY === true,
  readLine: (): Promise<string> => {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("", (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  },
  print: (s: string): void => {
    process.stdout.write(s);
  },
};

const CONSENT_PROMPT = [
  "chem-ag → telemetry consent",
  "Help us improve chem-ag by sharing anonymous usage data?",
  "- What we send: command names, exit codes, durations, OS, version.",
  "- What we DON'T send: file paths, code, project names, error messages.",
  "- Privacy policy: https://chemag.dev/privacy",
  "- Change anytime: chemag config set telemetry.enabled <true|false>",
  "",
  "Send anonymous usage telemetry? [y/N]: ",
].join("\n");

export const NON_INTERACTIVE_NOTE = "(telemetry off — run chemag config telemetry on to enable)";

/**
 * Resolve the chem-ag config directory. The CHEMAG_CONFIG_HOME env var lets
 * tests redirect to a tempdir without monkey-patching os.homedir.
 */
export function getConfigDir(): string {
  const override = process.env.CHEMAG_CONFIG_HOME;
  if (override !== undefined && override !== "") return override;
  return path.join(os.homedir(), ".config", "chemag");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

/**
 * Read the persistent chem-ag config file. Returns null if the file does not
 * exist OR if it is unreadable / not valid JSON / not the expected shape — in
 * all those cases the CLI should fall back to "no consent recorded" (and on
 * the next interactive run will re-prompt).
 */
export function loadConfig(): ChemagConfig | null {
  const filePath = getConfigPath();
  if (!existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const t = (parsed as { telemetry?: unknown }).telemetry;
  if (typeof t !== "object" || t === null) return null;
  const tel = t as Record<string, unknown>;
  if (typeof tel.enabled !== "boolean") return null;
  const out: ChemagConfig = { telemetry: { enabled: tel.enabled } };
  if (typeof tel.anonymousId === "string") out.telemetry.anonymousId = tel.anonymousId;
  if (typeof tel.optedInAt === "string") out.telemetry.optedInAt = tel.optedInAt;
  if (typeof tel.optedOutAt === "string") out.telemetry.optedOutAt = tel.optedOutAt;
  return out;
}

/**
 * Atomic write: write to a temp file in the same directory, fsync, then
 * rename. Avoids torn-write states if the process is killed mid-write.
 */
export function saveConfig(cfg: ChemagConfig): void {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  const filePath = getConfigPath();
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, `${JSON.stringify(cfg, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, filePath);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw e;
  }
}

/**
 * Build the "accepted" shape with a fresh UUID. Exported so tests can verify
 * consent acceptance writes the expected fields without re-reading the file.
 */
export function makeOptInConfig(now: () => Date = () => new Date()): ChemagConfig {
  return {
    telemetry: {
      enabled: true,
      anonymousId: randomUUID(),
      optedInAt: now().toISOString(),
    },
  };
}

export function makeOptOutConfig(now: () => Date = () => new Date()): ChemagConfig {
  return {
    telemetry: {
      enabled: false,
      optedOutAt: now().toISOString(),
    },
  };
}

/**
 * First-run consent prompt. Non-interactive callers (no TTY) immediately
 * resolve with `false` without invoking readLine. Interactive callers see
 * the consent block and a single line of input. Empty / "n" / "no" → false.
 * "y" / "Y" / "yes" → true. Any other input is treated as decline.
 *
 * NOTE: this function only RETURNS the user's choice. The caller is
 * responsible for persisting via saveConfig(makeOptInConfig() | makeOptOutConfig()).
 * Splitting prompt vs persistence keeps re-opt-in (which generates a fresh
 * UUID via makeOptInConfig) and decline (which writes optedOutAt only) on a
 * single saveConfig codepath.
 */
export async function promptForConsent(io: ConsentIO = defaultConsentIO): Promise<boolean> {
  if (!io.isInteractive()) {
    io.print(`${NON_INTERACTIVE_NOTE}\n`);
    return false;
  }
  io.print(CONSENT_PROMPT);
  const raw = await io.readLine();
  const answer = raw.trim().toLowerCase();
  return answer === "y" || answer === "yes";
}
