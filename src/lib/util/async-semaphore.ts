/**
 * A minimal counting semaphore for bounding concurrency of async work.
 *
 * `mapWithConcurrency` bounds a *single* fan-out (one batch request), but it
 * can't see the other requests running at the same time. A shared semaphore
 * is the piece that bounds work *across* independent callers: everyone routes
 * through one instance, so the total in flight never exceeds `permits` no
 * matter how many requests land at once. That is the difference between "each
 * request forks at most 6 git processes" and "the server forks at most 6 git
 * processes", which is what actually protects a machine that is also running
 * agents.
 */
export class AsyncSemaphore {
  private permits: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    // A zero or negative bound would deadlock every caller forever; clamp to a
    // usable floor rather than silently wedging the whole git surface.
    this.permits = Math.max(1, Math.floor(permits));
  }

  /** Permits currently free. Exposed for tests and instrumentation. */
  get available(): number {
    return this.permits;
  }

  /** Callers parked waiting for a permit. Exposed for tests and instrumentation. */
  get waiting(): number {
    return this.waiters.length;
  }

  private acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the permit straight to the next waiter instead of bouncing the
      // counter up and back down — that avoids a window where a newly-arriving
      // caller could jump an already-queued one.
      next();
    } else {
      this.permits += 1;
    }
  }

  /**
   * Run `fn` while holding a permit, releasing it on both success and failure.
   * The permit is always returned (the `finally`), so one rejected task can't
   * leak a permit and slowly starve the pool.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
