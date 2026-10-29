/**
 * When the controller restarts its server (docs/always-on-spec.md section 6.2).
 * The controller restarts the server itself: it knows whether an exit was
 * planned, whether the server is answering and how much memory it uses, and
 * it keeps the control socket up so status stays visible through a restart.
 * It never gives up: a crash loop slows to one attempt every 15 minutes.
 */
export interface RestartPolicy {
  /** Waits before each restart in a row: 1 s, 5 s, 15 s, 60 s, then `repeatMs`. */
  delaysMs: number[];
  repeatMs: number;
  /** Healthy this long, and the next failure starts the delays over. */
  steadyMs: number;
  /** This many unexpected exits inside the window is a crash loop. */
  loopCount: number;
  loopWindowMs: number;
  loopDelayMs: number;
}

export const RESTART_POLICY: RestartPolicy = {
  delaysMs: [1000, 5000, 15_000, 60_000], repeatMs: 5 * 60_000, steadyMs: 10 * 60_000,
  loopCount: 5, loopWindowMs: 15 * 60_000, loopDelayMs: 15 * 60_000,
};

export class RestartTracker {
  private exits: number[] = [];
  private inARow = 0;
  private healthySince: number | undefined;
  constructor(private readonly policy: RestartPolicy = RESTART_POLICY, private readonly now: () => number = Date.now) {}

  /** The server answered. */
  healthy() { this.healthySince ??= this.now(); }

  /** The server exited unexpectedly, or was stopped for not answering. */
  failed(): { delayMs: number; crashLoop: boolean } {
    const now = this.now();
    if (this.healthySince !== undefined && now - this.healthySince >= this.policy.steadyMs) this.inARow = 0;
    this.healthySince = undefined;
    this.exits = this.exits.filter(at => now - at < this.policy.loopWindowMs);
    this.exits.push(now);
    const crashLoop = this.exits.length >= this.policy.loopCount;
    const delayMs = crashLoop ? this.policy.loopDelayMs : this.policy.delaysMs[this.inARow] ?? this.policy.repeatMs;
    this.inARow++;
    return { delayMs, crashLoop };
  }

  get crashLooping() {
    const now = this.now();
    return this.exits.filter(at => now - at < this.policy.loopWindowMs).length >= this.policy.loopCount;
  }
}

/** A server that hasn't answered its readiness probe for this long is hung. Its
 * event loop is frozen, since an ordinary 2 s stall still answers in time. */
export const HANG_LIMIT_MS = 3 * 60_000;
export const PROBE_INTERVAL_MS = 15_000;
export const PROBE_TIMEOUT_MS = 10_000;

export class HangDetector {
  private lastAnswer: number;
  constructor(private readonly limitMs = HANG_LIMIT_MS, private readonly now: () => number = Date.now) { this.lastAnswer = now(); }
  answered() { this.lastAnswer = this.now(); }
  /** A fresh server is given the full limit to answer. */
  reset() { this.lastAnswer = this.now(); }
  hung() { return this.now() - this.lastAnswer >= this.limitMs; }
}

export interface Memory { heapUsed: number; heapLimit: number; rss: number }

/** A server this new isn't restarted for memory: it has had no time to leak,
 * so a restart can't lower it, and one that starts above the line would
 * otherwise restart every time it's idle. */
export const MEMORY_GRACE_MS = 10 * 60_000;

/** Past 75% of its heap limit the server restarts when idle. Past 90% it
 * restarts now, since crashing at the limit is worse than interrupting. */
export function memoryAction(memory: Memory | undefined, uptimeMs = Infinity, graceMs = MEMORY_GRACE_MS, idleShare = 0.75): 'none' | 'when-idle' | 'now' {
  if (!memory || !(memory.heapLimit > 0) || uptimeMs < graceMs) return 'none';
  const used = memory.heapUsed / memory.heapLimit;
  return used >= 0.9 ? 'now' : used >= idleShare ? 'when-idle' : 'none';
}
