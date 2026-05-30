/**
 * Global API-call semaphore around `@agentex/agent`'s dispatch path.
 * Caps concurrent in-flight provider sessions so a burst (multiple
 * schedules fire simultaneously, or a flood of webhook trigger fires)
 * doesn't smash into Anthropic's 429 ceiling.
 *
 * Capacity is a single tunable knob. Default 4 picked to be small but
 * not pessimistic: a single user with a few schedules + a chat session
 * + a heartbeat (V2) would land around three. Override per-environment
 * via `FLOW_API_LEASE_CAPACITY` if needed.
 *
 * Per-trigger lanes (`manual`/`cron`/`webhook`) are intentionally
 * deferred to V2. V1 trusts global rate limiting; revisit if real
 * contention shows up.
 */

const CAPACITY = (() => {
  const raw = process.env.FLOW_API_LEASE_CAPACITY;
  if (!raw) return 4;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
})();

/** Set survives Next.js module re-evaluation by stashing on globalThis. */
interface LeaseState {
  inflight: number;
  // FIFO queue of resolvers waiting for a slot. Each resolve() is the
  // signal "your lease is granted." We resolve them in arrival order so
  // long-tail dispatchers don't get starved by a hot schedule.
  waiters: Array<() => void>;
}

const STATE_KEY = Symbol.for('@flow/rate-lease-state');
const globalRef = globalThis as unknown as { [STATE_KEY]?: LeaseState };
if (!globalRef[STATE_KEY]) {
  globalRef[STATE_KEY] = { inflight: 0, waiters: [] };
}
const state = globalRef[STATE_KEY]!;

/**
 * Acquire a single API lease. Resolves immediately if there's slack,
 * otherwise blocks until another caller releases. Always release in a
 * `finally` so a thrown dispatch doesn't leak the lease.
 */
export function acquireApiLease(): Promise<void> {
  if (state.inflight < CAPACITY) {
    state.inflight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    state.waiters.push(() => {
      state.inflight++;
      resolve();
    });
  });
}

/**
 * Release a previously-acquired lease. Pumps one waiter if any are
 * queued — we always decrement first so the woken waiter's increment
 * lands against the post-release counter.
 */
export function releaseApiLease(): void {
  state.inflight = Math.max(0, state.inflight - 1);
  const next = state.waiters.shift();
  if (next) next();
}

/**
 * Convenience wrapper: acquire → run → release in a finally. Use this
 * everywhere unless you genuinely need to interleave acquire/release
 * with something else.
 */
export async function withApiLease<T>(fn: () => Promise<T>): Promise<T> {
  await acquireApiLease();
  try {
    return await fn();
  } finally {
    releaseApiLease();
  }
}

/** Diagnostic snapshot. Used by the runtime-status endpoint + tests. */
export function getApiLeaseStats(): { capacity: number; inflight: number; waiters: number } {
  return { capacity: CAPACITY, inflight: state.inflight, waiters: state.waiters.length };
}

/** Test seam. */
export function _resetApiLeaseState(): void {
  state.inflight = 0;
  state.waiters = [];
}
