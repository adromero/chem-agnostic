// Transport tests — fetch is fully mocked. Asserts retry/backoff, timeout
// behaviour, and that the disabled path makes ZERO network calls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sendEvent } from "../src/transport.js";
import { __resetTelemetryRuntimeForTesting, emit, initTelemetry } from "../src/index.js";
import {
  __resetTelemetryRunStateForTesting,
  setTelemetryEnabledForRun,
} from "../src/runtime-state.js";
import { makeOptInConfig, makeOptOutConfig, saveConfig } from "../src/consent.js";
import { getQueuePath, loadQueue } from "../src/queue.js";

let tmpDir: string;
let prevHome: string | undefined;

function makeFetchOk(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response("", { status: 200 }));
}

function makeFetchFailingOnce(status = 500): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response("", { status }));
}

function makeFetchAlwaysThrow(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => {
    throw new Error("network down");
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-transport-"));
  prevHome = process.env.CHEMAG_CONFIG_HOME;
  process.env.CHEMAG_CONFIG_HOME = tmpDir;
  __resetTelemetryRuntimeForTesting();
  __resetTelemetryRunStateForTesting();
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.CHEMAG_CONFIG_HOME;
  else process.env.CHEMAG_CONFIG_HOME = prevHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("sendEvent — happy path", () => {
  it("returns true on a 200 response and POSTs the expected body", async () => {
    const fetchImpl = makeFetchOk();
    const result = await sendEvent(
      {
        event: "cli.command.invoked",
        distinct_id: "anon-1",
        timestamp: "2026-01-01T00:00:00Z",
        properties: { command: "check" },
      },
      { fetchImpl, maxAttempts: 1 },
    );
    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toMatch(/\/capture\/$/);
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit & { body: string }).body);
    expect(body.event).toBe("cli.command.invoked");
    expect(body.distinct_id).toBe("anon-1");
    expect(body.api_key).toBeDefined();
  });
});

describe("sendEvent — retries", () => {
  it("retries up to maxAttempts on 5xx and gives up", async () => {
    const fetchImpl = makeFetchFailingOnce(500);
    const result = await sendEvent(
      {
        event: "x",
        distinct_id: "a",
        timestamp: "t",
        properties: {},
      },
      { fetchImpl, maxAttempts: 3, backoffMs: 1 },
    );
    expect(result).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on 4xx (permanent failure)", async () => {
    const fetchImpl = makeFetchFailingOnce(400);
    const result = await sendEvent(
      {
        event: "x",
        distinct_id: "a",
        timestamp: "t",
        properties: {},
      },
      { fetchImpl, maxAttempts: 3, backoffMs: 1 },
    );
    expect(result).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on network error then gives up", async () => {
    const fetchImpl = makeFetchAlwaysThrow();
    const result = await sendEvent(
      {
        event: "x",
        distinct_id: "a",
        timestamp: "t",
        properties: {},
      },
      { fetchImpl, maxAttempts: 3, backoffMs: 1 },
    );
    expect(result).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("emit — consent OFF makes ZERO network calls", () => {
  it("no fetch when no config exists", async () => {
    const fetchImpl = makeFetchOk();
    await initTelemetry({ fetchImpl, maxAttempts: 1, backoffMs: 1 });
    const result = await emit("cli.command.invoked", { command: "check" }, { fetchImpl });
    expect(result).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no fetch when telemetry.enabled is false", async () => {
    saveConfig(makeOptOutConfig());
    const fetchImpl = makeFetchOk();
    await initTelemetry({ fetchImpl, maxAttempts: 1, backoffMs: 1 });
    const result = await emit("cli.command.invoked", { command: "check" }, { fetchImpl });
    expect(result).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no fetch when --no-telemetry override is set, even if consent granted", async () => {
    saveConfig(makeOptInConfig());
    setTelemetryEnabledForRun(false);
    const fetchImpl = makeFetchOk();
    await initTelemetry({ fetchImpl, maxAttempts: 1, backoffMs: 1 });
    const result = await emit("cli.command.invoked", { command: "check" }, { fetchImpl });
    expect(result).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("emit — consent ON sends events", () => {
  it("calls fetch and returns true on success", async () => {
    saveConfig(makeOptInConfig());
    const fetchImpl = makeFetchOk();
    await initTelemetry({ fetchImpl, maxAttempts: 1, backoffMs: 1 });
    const result = await emit(
      "cli.command.invoked",
      { command: "check", language: "typescript" },
      { fetchImpl, maxAttempts: 1 },
    );
    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("on transport failure persists the event to ~/.config/chemag/queue.json", async () => {
    saveConfig(makeOptInConfig());
    const fetchImpl = makeFetchAlwaysThrow();
    await initTelemetry({ fetchImpl, maxAttempts: 1, backoffMs: 1 });

    const result = await emit(
      "cli.command.invoked",
      { command: "check" },
      { fetchImpl, maxAttempts: 1, backoffMs: 1 },
    );
    expect(result).toBe(false);
    expect(fs.existsSync(getQueuePath())).toBe(true);
    const queued = loadQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0].event).toBe("cli.command.invoked");
    expect(queued[0].properties.command).toBe("check");
  });

  it("anonymizes payload before transport (no file paths leak)", async () => {
    saveConfig(makeOptInConfig());
    const fetchImpl = makeFetchOk();
    await initTelemetry({ fetchImpl, maxAttempts: 1, backoffMs: 1 });
    await emit(
      "cli.command.invoked",
      { command: "check", extra: "/home/me/proj/file.ts" },
      { fetchImpl, maxAttempts: 1 },
    );
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit & { body: string }).body);
    expect(JSON.stringify(body)).not.toContain("/home/me/proj/file.ts");
    expect(JSON.stringify(body)).toContain("<redacted-path>");
  });
});
