// ---------------------------------------------------------------------------
// SubscriptionManager unit tests (WP-016 test criterion #17 + acceptance):
//
//   * subscribe → notifyChange invokes notifier exactly once with the URI
//   * per-URI fan-out: two subscribers on the same URI = one notifier call
//     per change (NOT one per subscriber)
//   * unsubscribe stops further notifications
//   * releaseSession drops every subscription owned by that session
//   * idempotent subscribe/unsubscribe
//   * close() cancels pending debounce timers
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSubscriptionManager } from "../src/subscriptions.js";

const FLUSH_MS = 30; // ample window for the debounceMs:0 microtask path.

function tick(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("SubscriptionManager — basic subscribe/notify roundtrip", () => {
  let cleanup: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanup) fn();
    cleanup = [];
  });

  it("notifier is called once with the URI on a subscribed change", async () => {
    const notifier = vi.fn();
    const mgr = createSubscriptionManager({ notifier, debounceMs: 0 });
    cleanup.push(() => mgr.close());

    mgr.subscribe("architecture://workspace", "session-A");
    mgr.notifyChange("architecture://workspace");
    await tick(FLUSH_MS);
    expect(notifier).toHaveBeenCalledTimes(1);
    expect(notifier).toHaveBeenCalledWith("architecture://workspace");
  });

  it("two subscribers on the same URI receive ONE notifier call (per-URI fan-out)", async () => {
    const notifier = vi.fn();
    const mgr = createSubscriptionManager({ notifier, debounceMs: 0 });
    cleanup.push(() => mgr.close());

    mgr.subscribe("architecture://workspace", "session-A");
    mgr.subscribe("architecture://workspace", "session-B");
    mgr.notifyChange("architecture://workspace");
    await tick(FLUSH_MS);
    expect(notifier).toHaveBeenCalledTimes(1);
  });

  it("notifyChange on an unsubscribed URI is a no-op", async () => {
    const notifier = vi.fn();
    const mgr = createSubscriptionManager({ notifier, debounceMs: 0 });
    cleanup.push(() => mgr.close());

    mgr.notifyChange("architecture://workspace");
    await tick(FLUSH_MS);
    expect(notifier).not.toHaveBeenCalled();
  });

  it("idempotent subscribe — subscribing twice still produces one notifier call", async () => {
    const notifier = vi.fn();
    const mgr = createSubscriptionManager({ notifier, debounceMs: 0 });
    cleanup.push(() => mgr.close());

    mgr.subscribe("architecture://workspace", "session-A");
    mgr.subscribe("architecture://workspace", "session-A");
    mgr.notifyChange("architecture://workspace");
    await tick(FLUSH_MS);
    expect(notifier).toHaveBeenCalledTimes(1);
  });

  it("notifier is invoked exactly once with the fired URI (notifier-delegation contract)", async () => {
    const notifier = vi.fn();
    const mgr = createSubscriptionManager({ notifier, debounceMs: 0 });
    cleanup.push(() => mgr.close());

    mgr.subscribe("architecture://workspace", "session-A");
    mgr.notifyChange("architecture://workspace");
    await tick(FLUSH_MS);

    // Subscribe a second session, fire again — still per-URI, so still one
    // call PER notifyChange.
    mgr.subscribe("architecture://workspace", "session-B");
    mgr.notifyChange("architecture://workspace");
    await tick(FLUSH_MS);
    expect(notifier).toHaveBeenCalledTimes(2);

    // releaseSession drops one subscriber but the URI is still subscribed.
    mgr.releaseSession("session-A");
    mgr.notifyChange("architecture://workspace");
    await tick(FLUSH_MS);
    expect(notifier).toHaveBeenCalledTimes(3);

    // Drop the last session — notifier no longer fires.
    mgr.releaseSession("session-B");
    mgr.notifyChange("architecture://workspace");
    await tick(FLUSH_MS);
    expect(notifier).toHaveBeenCalledTimes(3);
  });
});

describe("SubscriptionManager — unsubscribe + dispose", () => {
  it("unsubscribe stops further notifications for that (uri, session) pair", async () => {
    const notifier = vi.fn();
    const mgr = createSubscriptionManager({ notifier, debounceMs: 0 });

    mgr.subscribe("architecture://violations", "session-A");
    mgr.notifyChange("architecture://violations");
    await tick(FLUSH_MS);
    expect(notifier).toHaveBeenCalledTimes(1);

    mgr.unsubscribe("architecture://violations", "session-A");
    mgr.notifyChange("architecture://violations");
    await tick(FLUSH_MS);
    expect(notifier).toHaveBeenCalledTimes(1);
    mgr.close();
  });

  it("unsubscribing an unknown pair is a no-op", () => {
    const notifier = vi.fn();
    const mgr = createSubscriptionManager({ notifier, debounceMs: 0 });
    expect(() => mgr.unsubscribe("architecture://workspace", "ghost")).not.toThrow();
    mgr.close();
  });

  it("releaseSession drops every subscription owned by the session", async () => {
    const notifier = vi.fn();
    const mgr = createSubscriptionManager({ notifier, debounceMs: 0 });

    mgr.subscribe("architecture://workspace", "session-A");
    mgr.subscribe("architecture://violations", "session-A");
    mgr.subscribe("architecture://graph.mermaid", "session-A");
    mgr.releaseSession("session-A");

    mgr.notifyChange("architecture://workspace");
    mgr.notifyChange("architecture://violations");
    mgr.notifyChange("architecture://graph.mermaid");
    await tick(FLUSH_MS);
    expect(notifier).not.toHaveBeenCalled();
    mgr.close();
  });

  it("close() cancels pending debounce timers and prevents future notifies", async () => {
    const notifier = vi.fn();
    const mgr = createSubscriptionManager({ notifier, debounceMs: 50 });
    mgr.subscribe("architecture://workspace", "session-A");
    mgr.notifyChange("architecture://workspace");
    mgr.close();
    await tick(80);
    expect(notifier).not.toHaveBeenCalled();
  });
});

describe("SubscriptionManager — debounce", () => {
  it("bursts on the same URI coalesce into one notifier call", async () => {
    const notifier = vi.fn();
    const mgr = createSubscriptionManager({ notifier, debounceMs: 50 });

    mgr.subscribe("architecture://workspace", "session-A");
    for (let i = 0; i < 5; i++) {
      mgr.notifyChange("architecture://workspace");
    }
    await tick(120);
    expect(notifier).toHaveBeenCalledTimes(1);
    mgr.close();
  });
});
