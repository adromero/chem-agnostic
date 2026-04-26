// ---------------------------------------------------------------------------
// Persistent telemetry event queue.
//
// Events that fail transport (after the per-event retry budget) are appended
// to ~/.config/chemag/queue.json. On the next CLI run, flushQueue reads,
// retries, and removes successfully sent events.
//
// File format: a JSON array of QueuedEvent objects, persisted atomically via
// tempfile + rename. The 1 MB cap is enforced on append: we drop oldest events
// (FIFO) until the resulting file fits.
// ---------------------------------------------------------------------------

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import * as path from "node:path";
import { getConfigDir } from "./consent.js";

export interface QueuedEvent {
  event: string;
  properties: Record<string, unknown>;
  distinct_id: string;
  timestamp: string;
}

export const QUEUE_MAX_BYTES = 1024 * 1024; // 1 MB

export function getQueuePath(): string {
  return path.join(getConfigDir(), "queue.json");
}

export function loadQueue(): QueuedEvent[] {
  const filePath = getQueuePath();
  if (!existsSync(filePath)) return [];
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  // Validate each event has the required shape; drop malformed entries.
  return parsed.filter(isQueuedEvent);
}

function isQueuedEvent(v: unknown): v is QueuedEvent {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.event === "string" &&
    typeof e.distinct_id === "string" &&
    typeof e.timestamp === "string" &&
    typeof e.properties === "object" &&
    e.properties !== null
  );
}

/**
 * Persist the queue to disk. Enforces the 1 MB cap with FIFO eviction:
 * oldest events are dropped until the serialized form fits. Empty queue
 * deletes the file (clean state).
 */
export function saveQueue(events: QueuedEvent[]): QueuedEvent[] {
  const dir = getConfigDir();
  const filePath = getQueuePath();

  // FIFO trim: drop oldest until we fit.
  const trimmed = events.slice();
  let serialized = JSON.stringify(trimmed);
  while (Buffer.byteLength(serialized, "utf-8") > QUEUE_MAX_BYTES && trimmed.length > 0) {
    trimmed.shift();
    serialized = JSON.stringify(trimmed);
  }

  if (trimmed.length === 0) {
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        // best-effort
      }
    }
    return trimmed;
  }

  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, serialized);
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
  return trimmed;
}

/**
 * Append a single event and persist the resulting queue. Returns the queue
 * after eviction (so the caller can observe whether their event survived).
 */
export function appendToQueue(events: QueuedEvent[], next: QueuedEvent): QueuedEvent[] {
  const merged = [...events, next];
  return saveQueue(merged);
}
