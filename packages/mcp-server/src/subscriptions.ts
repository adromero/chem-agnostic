// ---------------------------------------------------------------------------
// SubscriptionManager — keeps track of which sessions are subscribed to
// which resource URIs, and fans out `notifications/resources/updated`
// notifications when the watcher reports a relevant filesystem change.
//
// Pure module — DOES NOT import from `@modelcontextprotocol/sdk/*`. The
// transport-specific notifier is injected by the call site (server.ts), which
// passes a closure that calls `server.server.sendResourceUpdated({ uri })`.
// Tests inject a `vi.fn()` instead and verify the manager calls it with the
// right arguments. This keeps the module trivially unit-testable and
// transport-agnostic.
//
// Idempotency: subscribing the same (uri, sessionId) twice is a no-op; an
// unsubscribe for an unsubscribed pair is also a no-op. `releaseSession`
// drops every subscription owned by a session, used by `Session.dispose()`.
//
// Per-URI debouncing: notifyChange(uri) coalesces bursts on the same URI
// into a single notifier call. The default debounce window is 100ms; tests
// pass `debounceMs: 0` to fire synchronously (well, on the next microtask).
// ---------------------------------------------------------------------------

export interface SubscriptionManagerOptions {
  /**
   * Notifier callback. The call site in server.ts passes
   *   (uri) => server.server.sendResourceUpdated({ uri })
   * which delegates to the low-level Server's notification API.
   * Tests pass a vi.fn() instead.
   */
  notifier: (uri: string) => void;
  /** Debounce per-URI updates. Defaults to 100ms. */
  debounceMs?: number;
}

export interface SubscriptionManager {
  subscribe(uri: string, sessionId: string): void;
  unsubscribe(uri: string, sessionId: string): void;
  /** Drop every subscription owned by the given session. */
  releaseSession(sessionId: string): void;
  /** Called by the watcher pipeline. Fans out to all subscribers of `uri`. */
  notifyChange(uri: string): void;
  /** Dispose internal timers; idempotent. */
  close(): void;
}

const DEFAULT_DEBOUNCE_MS = 100;

class InMemorySubscriptionManager implements SubscriptionManager {
  /** uri -> Set<sessionId>. The set being non-empty means the URI is "live". */
  private readonly byUri = new Map<string, Set<string>>();
  /** Pending debounce timers per URI. */
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly notifier: (uri: string) => void;
  private readonly debounceMs: number;
  private closed = false;

  constructor(opts: SubscriptionManagerOptions) {
    this.notifier = opts.notifier;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  subscribe(uri: string, sessionId: string): void {
    if (this.closed) return;
    let set = this.byUri.get(uri);
    if (!set) {
      set = new Set();
      this.byUri.set(uri, set);
    }
    set.add(sessionId);
  }

  unsubscribe(uri: string, sessionId: string): void {
    const set = this.byUri.get(uri);
    if (!set) return;
    set.delete(sessionId);
    if (set.size === 0) {
      this.byUri.delete(uri);
      // Cancel any pending debounce — no-one is listening anyway.
      const timer = this.pending.get(uri);
      if (timer !== undefined) {
        clearTimeout(timer);
        this.pending.delete(uri);
      }
    }
  }

  releaseSession(sessionId: string): void {
    // Iterate a snapshot of URIs because we may delete entries during the loop.
    const uris = [...this.byUri.keys()];
    for (const uri of uris) {
      const set = this.byUri.get(uri);
      if (!set) continue;
      if (set.delete(sessionId) && set.size === 0) {
        this.byUri.delete(uri);
        const timer = this.pending.get(uri);
        if (timer !== undefined) {
          clearTimeout(timer);
          this.pending.delete(uri);
        }
      }
    }
  }

  notifyChange(uri: string): void {
    if (this.closed) return;
    // No subscribers? Skip — both the timer and the notifier call.
    const set = this.byUri.get(uri);
    if (!set || set.size === 0) return;

    // Debounce per URI: if a timer is already pending, leave it in place.
    if (this.pending.has(uri)) return;

    const fire = (): void => {
      this.pending.delete(uri);
      // Re-check subscribers — they may have all unsubscribed during the wait.
      const live = this.byUri.get(uri);
      if (!live || live.size === 0) return;
      // Per-URI fan-out — one notifier call per URI, NOT per subscriber.
      try {
        this.notifier(uri);
      } catch {
        // Notifier is best-effort; never let a transport hiccup break the
        // watcher pipeline.
      }
    };

    if (this.debounceMs <= 0) {
      // Schedule on the next microtask to keep semantics consistent with the
      // debounced path (callers shouldn't see synchronous re-entry).
      const timer = setTimeout(fire, 0);
      this.pending.set(uri, timer);
      // Allow the process to exit while a 0-ms debounce is pending.
      if (typeof timer === "object" && timer !== null && "unref" in timer) {
        (timer as { unref: () => void }).unref();
      }
      return;
    }

    const timer = setTimeout(fire, this.debounceMs);
    this.pending.set(uri, timer);
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      (timer as { unref: () => void }).unref();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
    this.byUri.clear();
  }
}

/**
 * Construct a fresh SubscriptionManager. The returned object has no SDK
 * dependency — it only knows how to call the supplied `notifier(uri)` when a
 * subscribed URI's underlying resource changes.
 */
export function createSubscriptionManager(
  opts: SubscriptionManagerOptions,
): SubscriptionManager {
  return new InMemorySubscriptionManager(opts);
}
