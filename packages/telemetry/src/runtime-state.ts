// ---------------------------------------------------------------------------
// Run-local telemetry override.
//
// Phase 1.6 of cli.ts toggles this when --no-telemetry is present. emit() in
// index.ts consults runOverride first; if false, no event is queued or sent
// regardless of the persistent consent in ~/.config/chemag/config.json.
//
// One-shot per process. Does NOT mutate the config file.
// ---------------------------------------------------------------------------

let runOverride: boolean | null = null;

export function setTelemetryEnabledForRun(value: boolean): void {
  runOverride = value;
}

export function getTelemetryRunOverride(): boolean | null {
  return runOverride;
}

export function __resetTelemetryRunStateForTesting(): void {
  runOverride = null;
}
