// ---------------------------------------------------------------------------
// PostHog transport.
//
// POSTs a single event to the PostHog Cloud (US) /capture/ endpoint.
// 5-second timeout per attempt; up to 3 attempts with exponential backoff.
// All network failures are swallowed and surfaced as a boolean result so
// the caller (index.ts) can persist to the fallback queue.
//
// The public PostHog project key is ingestion-only (no read scope) and may
// be embedded in the package. It is overridable via CHEMAG_POSTHOG_KEY for
// self-hosted deployments and CHEMAG_POSTHOG_HOST for the endpoint.
//
// Dependency injection: `sendEvent` accepts an optional `fetchImpl` so tests
// can pass a mock without touching the global fetch.
// ---------------------------------------------------------------------------

import type { QueuedEvent } from "./queue.js";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
// Public ingestion-only key. Replace at release time with the real chemag
// project key. Operators self-hosting can override via CHEMAG_POSTHOG_KEY.
const DEFAULT_POSTHOG_KEY = "phc_chemag_public_ingestion_key_placeholder";

export interface TransportOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
}

/**
 * Attempt to deliver a single event. Returns true on 2xx, false on any
 * non-2xx, network error, or timeout after exhausting retries.
 */
export async function sendEvent(event: QueuedEvent, opts: TransportOptions = {}): Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return false;

  const timeoutMs = opts.timeoutMs ?? 5_000;
  const maxAttempts = opts.maxAttempts ?? 3;
  const backoffMs = opts.backoffMs ?? 250;

  const host = process.env.CHEMAG_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST;
  const key = process.env.CHEMAG_POSTHOG_KEY ?? DEFAULT_POSTHOG_KEY;
  const url = `${host.replace(/\/+$/, "")}/capture/`;

  const body = JSON.stringify({
    api_key: key,
    event: event.event,
    distinct_id: event.distinct_id,
    properties: event.properties,
    timestamp: event.timestamp,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return true;
      // Non-2xx: only retry on 5xx; 4xx is a permanent failure.
      if (res.status >= 400 && res.status < 500) return false;
    } catch {
      clearTimeout(timer);
      // network error / timeout / abort — fall through to retry.
    }
    if (attempt < maxAttempts) {
      await delay(backoffMs * 2 ** (attempt - 1));
    }
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
