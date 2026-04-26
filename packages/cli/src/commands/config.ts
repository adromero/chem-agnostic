// ---------------------------------------------------------------------------
// `chemag config get/set ...`
//
// Minimal scope for WP-006: only `telemetry.enabled` is supported. WP-008
// supersedes this with the full config surface.
//
// Behaviour:
//   - `config get telemetry.enabled`   → prints "true" or "false" (default false).
//   - `config set telemetry.enabled true|false`
//        true  → writes a fresh opt-in config (new UUID, new optedInAt).
//                Any prior anonymousId is NOT resurrected.
//        false → writes an opt-out config (no anonymousId).
//
// Rationale: re-opt-in MUST regenerate the UUID per the spec — generating
// here keeps the config-file invariant in one codepath (consent.ts owns the
// shape; we delegate via makeOptInConfig / makeOptOutConfig).
// ---------------------------------------------------------------------------

import { loadConfig, makeOptInConfig, makeOptOutConfig, saveConfig } from "@chemag/telemetry";

const RED = "\x1b[31m";
const R = "\x1b[0m";

export function cmdConfig(argv: string[]): void {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(
      "config — get or set chem-ag configuration values.\n" +
        "Usage: chemag config get <key>\n" +
        "       chemag config set <key> <value>\n" +
        "\n" +
        "Supported keys (WP-006 minimal): telemetry.enabled",
    );
    process.exit(0);
  }

  const op = argv[0];
  const key = argv[1];

  if (op === "get") {
    if (key !== "telemetry.enabled") {
      console.error(`${RED}Unknown config key:${R} ${key ?? "<missing>"}`);
      process.exit(2);
    }
    const cfg = loadConfig();
    console.log(cfg?.telemetry.enabled === true ? "true" : "false");
    process.exit(0);
  }

  if (op === "set") {
    const value = argv[2];
    if (key !== "telemetry.enabled") {
      console.error(`${RED}Unknown config key:${R} ${key ?? "<missing>"}`);
      process.exit(2);
    }
    if (value !== "true" && value !== "false") {
      console.error(`${RED}Value for telemetry.enabled must be 'true' or 'false'${R}`);
      process.exit(2);
    }
    const next = value === "true" ? makeOptInConfig() : makeOptOutConfig();
    saveConfig(next);
    process.exit(0);
  }

  console.error(`${RED}Unknown config operation:${R} ${op ?? "<missing>"}`);
  console.error("Run 'chemag config --help' for usage.");
  process.exit(2);
}
