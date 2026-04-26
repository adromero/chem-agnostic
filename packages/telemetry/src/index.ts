// ---------------------------------------------------------------------------
// @chemag/telemetry — opt-in usage analytics.
//
// Public surface:
//   initTelemetry            — load consent + flush any queued events from prior runs.
//   emit                     — enqueue/send a single event (no-op if disabled).
//   flushQueue               — drain the persistent fallback queue best-effort.
//   setTelemetryEnabledForRun— Phase-1.6 run-only override for cli.ts.
//   promptForConsent         — first-run prompt; returns true on accept.
//   loadConfig / saveConfig  — config IO for `chemag config get/set`.
//
// Privacy invariants:
//   - Default OFF. No event leaves the machine until consent is recorded
//     AND the run-override (if present) is not `false`.
//   - Anonymous distinct_id is generated only on opt-in. Re-opt-in produces
//     a fresh UUID; the previous one is never resurrected.
//   - All payloads pass through anonymize() before transport (defence in
//     depth — callers should already be sending only safe fields).
// ---------------------------------------------------------------------------

import { type ChemagConfig, loadConfig } from "./consent.js";
import { anonymize } from "./anonymizer.js";
import { type QueuedEvent, appendToQueue, loadQueue, saveQueue } from "./queue.js";
import { type TransportOptions, sendEvent } from "./transport.js";
import { getTelemetryRunOverride } from "./runtime-state.js";

// Re-exports for the CLI.
export {
  type ChemagConfig,
  type ConsentIO,
  type TelemetryConfig,
  defaultConsentIO,
  loadConfig,
  promptForConsent,
  saveConfig,
  getConfigDir,
  getConfigPath,
  makeOptInConfig,
  makeOptOutConfig,
  NON_INTERACTIVE_NOTE,
} from "./consent.js";
export { anonymize } from "./anonymizer.js";
export {
  type QueuedEvent,
  QUEUE_MAX_BYTES,
  getQueuePath,
  loadQueue,
  saveQueue,
} from "./queue.js";
export {
  setTelemetryEnabledForRun,
  getTelemetryRunOverride,
  __resetTelemetryRunStateForTesting,
} from "./runtime-state.js";

export interface TelemetryRuntime {
  enabled: boolean;
  distinctId: string | null;
  config: ChemagConfig | null;
}

let runtime: TelemetryRuntime = { enabled: false, distinctId: null, config: null };

/**
 * Resolve consent state for this process and return the runtime descriptor.
 * Called once early in cli.ts (after Phase-1.6 override is set). If the
 * persistent config grants consent, this also kicks off a best-effort flush
 * of any queued events from prior runs.
 *
 * Does NOT prompt the user; the consent prompt is owned by cli.ts so first-
 * run UX can interleave with the dispatcher (e.g. don't prompt during a
 * --help run).
 */
export async function initTelemetry(opts: TransportOptions = {}): Promise<TelemetryRuntime> {
  const cfg = loadConfig();
  const enabled = isEnabled(cfg);
  runtime = {
    enabled,
    distinctId: cfg?.telemetry.anonymousId ?? null,
    config: cfg,
  };
  if (enabled) {
    await flushQueue(opts);
  }
  return runtime;
}

export function getTelemetryRuntime(): TelemetryRuntime {
  return runtime;
}

export function __resetTelemetryRuntimeForTesting(): void {
  runtime = { enabled: false, distinctId: null, config: null };
}

/**
 * Determine whether telemetry should fire. Honors the Phase-1.6 run override
 * first; falls back to the persistent config. The override is the highest-
 * priority signal — if cli.ts called setTelemetryEnabledForRun(false), no
 * event ever ships regardless of consent.
 */
function isEnabled(cfg: ChemagConfig | null): boolean {
  const override = getTelemetryRunOverride();
  if (override === false) return false;
  return cfg?.telemetry.enabled === true;
}

function buildEvent(
  event: string,
  properties: Record<string, unknown>,
  distinctId: string,
): QueuedEvent {
  const enriched: Record<string, unknown> = {
    os: process.platform,
    node_version: process.version,
    ...properties,
  };
  return {
    event,
    properties: anonymize(enriched),
    distinct_id: distinctId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Emit a single telemetry event. No-op when telemetry is disabled or when no
 * distinct_id is available. On transport failure the event lands in the
 * persistent queue for retry on the next run.
 */
export async function emit(
  event: string,
  properties: Record<string, unknown> = {},
  opts: TransportOptions = {},
): Promise<boolean> {
  const cfg = runtime.config ?? loadConfig();
  if (!isEnabled(cfg)) return false;
  const distinctId = runtime.distinctId ?? cfg?.telemetry.anonymousId ?? null;
  if (distinctId === null) return false;

  const queued = buildEvent(event, properties, distinctId);
  const ok = await sendEvent(queued, opts);
  if (!ok) {
    appendToQueue(loadQueue(), queued);
  }
  return ok;
}

/**
 * Drain the persistent queue. Each event is given the per-event retry budget
 * defined in transport.ts (3 attempts). Successful events are removed;
 * failures stay (and may be FIFO-evicted on the next append).
 */
export async function flushQueue(opts: TransportOptions = {}): Promise<{
  sent: number;
  remaining: number;
}> {
  const queue = loadQueue();
  if (queue.length === 0) return { sent: 0, remaining: 0 };

  const survivors: QueuedEvent[] = [];
  let sent = 0;
  for (const ev of queue) {
    const ok = await sendEvent(ev, opts);
    if (ok) sent++;
    else survivors.push(ev);
  }
  const final = saveQueue(survivors);
  return { sent, remaining: final.length };
}

/**
 * True when no config file exists yet — used by cli.ts to decide whether to
 * run the first-run consent prompt.
 */
export function isFirstRun(): boolean {
  return loadConfig() === null;
}

export function __setRuntimeForTesting(next: Partial<TelemetryRuntime>): void {
  runtime = { ...runtime, ...next };
}
