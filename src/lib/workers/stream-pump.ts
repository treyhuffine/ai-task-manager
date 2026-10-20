/**
 * A worker stream's delivery passes (`/api/workers/me/stream`). Each pass
 * settles commands for placements this device no longer holds, checks again
 * the sends about to leave (a send carrying app context may no longer be
 * allowed, `recheckQueuedSends`), then hands the device what is queued. The
 * check awaits, so passes never overlap: a wake that arrives during one runs
 * one more pass after it, which sees whatever was queued meanwhile.
 */
export interface StreamPumpSteps {
  /** Whether delivery should stop: the stream closed, or the home is in maintenance. */
  stopped: () => boolean;
  /** Settle queued commands whose chat or execution no longer runs on this device. */
  settleStale: () => void;
  /** Check again the sends about to leave, withdrawing any no longer allowed. */
  recheck: () => Promise<unknown>;
  /** Number and send what is queued. */
  deliver: () => void;
  /** A pass that threw. Delivery carries on at the next wake. */
  onError?: (error: unknown) => void;
}

/** A `pump` to call on every wake. It returns the pass it started or joined, for tests. */
export function createStreamPump(steps: StreamPumpSteps): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  return () => {
    if (steps.stopped()) return Promise.resolve();
    if (running) { again = true; return running; }
    running = (async () => {
      try {
        do {
          again = false;
          steps.settleStale();
          await steps.recheck();
          if (steps.stopped()) return;
          steps.deliver();
        } while (again && !steps.stopped());
      } catch (error) {
        steps.onError?.(error);
      } finally {
        running = null;
      }
    })();
    return running;
  };
}
