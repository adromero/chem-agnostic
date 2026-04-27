// ---------------------------------------------------------------------------
// UI: spinner
//
// Thin wrapper over `nanospinner`. Spinners only render when:
//   - stdout is a TTY (otherwise we'd just dump escape codes into a log file)
//   - `--quiet` was not passed (caller-supplied)
//   - the operation actually exceeds a 500 ms threshold (otherwise the
//     spinner would flicker for fast no-ops)
//
// Threshold semantics:
//   - On `start()`, we record the wall-clock start time but do NOT call into
//     nanospinner yet.
//   - We schedule a setTimeout for `thresholdMs` (default 500). If the
//     spinner is still running when the timer fires, we kick the underlying
//     nanospinner to start drawing.
//   - On `succeed()` / `fail()` / `stop()` we clear the timer. If the spinner
//     never actually started rendering, we just print the final message
//     (succeed/fail) without any frame churn.
//
// Test affordance: `withSpinner` accepts a `clock` shim so a vitest
// `vi.useFakeTimers()` test can advance the timer past the threshold and
// observe whether the spinner started.
// ---------------------------------------------------------------------------

import { createSpinner, type Spinner } from "nanospinner";

export type SpinnerHandle = {
  /** Mark the operation as successful. Prints `text` if the spinner started. */
  succeed(text?: string): void;
  /** Mark the operation as failed. Prints `text` if the spinner started. */
  fail(text?: string): void;
  /** Stop without printing a final frame. */
  stop(): void;
  /** True iff the spinner ever started rendering (i.e. crossed the threshold). */
  didRender(): boolean;
};

export type SpinnerOptions = {
  /** Initial label shown next to the spinner. */
  text: string;
  /** ms to wait before the underlying nanospinner starts drawing. Default 500. */
  thresholdMs?: number;
  /** When true, the spinner is fully suppressed (also suppresses succeed/fail text). */
  quiet?: boolean;
  /** Override the TTY check (used for tests). Default: process.stdout.isTTY. */
  isTTY?: boolean;
  /** Test seam — replaces setTimeout/clearTimeout with custom hooks. */
  clock?: TestClock;
};

type TestClock = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const DEFAULT_THRESHOLD_MS = 500;

/**
 * Start a spinner that only actually renders if the operation outlasts
 * `thresholdMs`. Returns a handle the caller uses to terminate it.
 */
export function startSpinner(opts: SpinnerOptions): SpinnerHandle {
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);
  const quiet = opts.quiet === true;
  const threshold = opts.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const clock: TestClock = opts.clock ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };

  // If we'd never render anyway, return a handle that prints final text only.
  if (!isTTY || quiet) {
    return makeNoopHandle(quiet);
  }

  let inner: Spinner | null = null;
  let rendered = false;
  let stopped = false;

  const timer = clock.setTimeout(() => {
    if (stopped) return;
    inner = createSpinner(opts.text).start();
    rendered = true;
  }, threshold);

  return {
    succeed(text?: string) {
      stopped = true;
      clock.clearTimeout(timer);
      if (inner) inner.success({ text: text ?? opts.text });
    },
    fail(text?: string) {
      stopped = true;
      clock.clearTimeout(timer);
      if (inner) inner.error({ text: text ?? opts.text });
    },
    stop() {
      stopped = true;
      clock.clearTimeout(timer);
      if (inner) inner.stop();
    },
    didRender(): boolean {
      return rendered;
    },
  };
}

function makeNoopHandle(_quiet: boolean): SpinnerHandle {
  return {
    succeed(_text?: string) {
      // intentionally silent — caller is non-TTY or asked for quiet
    },
    fail(_text?: string) {
      // intentionally silent
    },
    stop() {},
    didRender() {
      return false;
    },
  };
}

/**
 * Convenience wrapper: run an async op while a threshold-gated spinner is
 * displayed. Returns the op's return value. On throw, the spinner stops
 * cleanly (no final frame) and the error propagates.
 */
export async function withSpinner<T>(opts: SpinnerOptions, op: () => Promise<T>): Promise<T> {
  const sp = startSpinner(opts);
  try {
    const result = await op();
    sp.stop();
    return result;
  } catch (err) {
    sp.stop();
    throw err;
  }
}
