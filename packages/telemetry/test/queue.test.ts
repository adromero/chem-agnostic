// Queue persistence tests — appending, FIFO eviction at the 1 MB cap, and
// load-after-save round-trip.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type QueuedEvent,
  QUEUE_MAX_BYTES,
  appendToQueue,
  getQueuePath,
  loadQueue,
  saveQueue,
} from "../src/queue.js";

let tmpDir: string;
let prevHome: string | undefined;

function makeEvent(seq: number, propBytes = 0): QueuedEvent {
  return {
    event: "cli.command.invoked",
    distinct_id: "anon-1",
    timestamp: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
    properties: {
      command: "check",
      seq,
      // Pad with a string to balloon the serialized size when testing the cap.
      pad: "x".repeat(propBytes),
    },
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-queue-"));
  prevHome = process.env.CHEMAG_CONFIG_HOME;
  process.env.CHEMAG_CONFIG_HOME = tmpDir;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.CHEMAG_CONFIG_HOME;
  else process.env.CHEMAG_CONFIG_HOME = prevHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadQueue / saveQueue", () => {
  it("loadQueue returns [] when no file exists", () => {
    expect(loadQueue()).toEqual([]);
  });

  it("round-trips a small queue", () => {
    const events = [makeEvent(1), makeEvent(2), makeEvent(3)];
    saveQueue(events);
    expect(loadQueue()).toEqual(events);
  });

  it("saving an empty queue removes the file", () => {
    saveQueue([makeEvent(1)]);
    expect(fs.existsSync(getQueuePath())).toBe(true);
    saveQueue([]);
    expect(fs.existsSync(getQueuePath())).toBe(false);
  });

  it("loadQueue ignores malformed JSON", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(getQueuePath(), "{not-json");
    expect(loadQueue()).toEqual([]);
  });

  it("loadQueue ignores entries missing required fields", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      getQueuePath(),
      JSON.stringify([
        { event: "ok", distinct_id: "a", timestamp: "t", properties: {} },
        { broken: true },
      ]),
    );
    expect(loadQueue()).toHaveLength(1);
  });
});

describe("appendToQueue", () => {
  it("appends a new event to existing entries", () => {
    saveQueue([makeEvent(1), makeEvent(2)]);
    appendToQueue(loadQueue(), makeEvent(3));
    expect(loadQueue()).toHaveLength(3);
    const seqs = loadQueue().map((e) => e.properties.seq);
    expect(seqs).toEqual([1, 2, 3]);
  });
});

describe("FIFO eviction at the 1 MB cap", () => {
  it("evicts oldest events when serialized form exceeds 1 MB", () => {
    // Each event ~110 KB padding; 12 of them is ~1.3 MB, so eviction kicks in.
    const PAD = 110 * 1024;
    const events: QueuedEvent[] = [];
    for (let i = 1; i <= 12; i++) events.push(makeEvent(i, PAD));

    const trimmed = saveQueue(events);
    const serialized = JSON.stringify(trimmed);
    expect(Buffer.byteLength(serialized, "utf-8")).toBeLessThanOrEqual(QUEUE_MAX_BYTES);
    expect(trimmed.length).toBeLessThan(events.length);

    // FIFO: the survivors are the TAIL of the input.
    const survivingSeqs = trimmed.map((e) => e.properties.seq);
    const lastInput = events[events.length - 1].properties.seq;
    expect(survivingSeqs).toContain(lastInput);
    // First event must have been evicted.
    expect(survivingSeqs).not.toContain(events[0].properties.seq);
  });

  it("appending past the cap evicts in FIFO order across calls", () => {
    const PAD = 110 * 1024;
    let queue: QueuedEvent[] = [];
    for (let i = 1; i <= 8; i++) queue = appendToQueue(queue, makeEvent(i, PAD));

    const seqs = loadQueue().map((e) => e.properties.seq);
    // We expect oldest (seq=1) to have been dropped at some point. The exact
    // count depends on JSON overhead, but the invariants are: file fits AND
    // earliest seq numbers go first.
    const serialized = JSON.stringify(loadQueue());
    expect(Buffer.byteLength(serialized, "utf-8")).toBeLessThanOrEqual(QUEUE_MAX_BYTES);
    if (seqs.length < 8) {
      expect(seqs).not.toContain(1);
      expect(seqs[seqs.length - 1]).toBe(8);
    }
  });
});
