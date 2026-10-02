/**
 * Wait for a page to settle after an act, so the result shows what the act
 * caused. An autocomplete is the hard case: typing fires key events, the
 * widget waits out its debounce (nothing happens), fetches suggestions, then
 * renders them into a popover. Returning before the render is how an agent
 * concludes "no suggestions appeared".
 *
 * Settled means: past a floor (long enough for a typical debounce after
 * typing), no request of the page's in flight, and neither the network nor the
 * DOM has moved for a quiet window. Bounded by a cap, because some pages never
 * go quiet (long polls, tickers, animated counters).
 */

import type { BrowserContext, Page, Request } from 'playwright-core';

export interface SettleTiming {
  /** Minimum wait after the act, whatever happens. */
  floorMs: number;
  /** How long network and DOM must both stay still. */
  quietMs: number;
  /** Give up waiting after this long and return what is there. */
  maxMs: number;
}

/** After a click, select, evaluate, or anything else. */
export const SETTLE_DEFAULT: SettleTiming = { floorMs: 0, quietMs: 250, maxMs: 3_000 };
/** After typing or a key press: room for a debounce before suggestions load. */
export const SETTLE_TYPING: SettleTiming = { floorMs: 600, quietMs: 300, maxMs: 4_000 };
/** Between batch steps that don't need the full wait. */
export const SETTLE_STEP: SettleTiming = { floorMs: 0, quietMs: 150, maxMs: 1_500 };

/** Requests that stay open by design and should not hold the settle. */
const IGNORED_TYPES = new Set(['websocket', 'eventsource', 'manifest', 'beacon', 'ping']);
/** A request open longer than this is a long poll, not pending work. */
const LONG_POLL_MS = 3_000;

const MUTATION_KEY = 'ri.lastMutation';

/**
 * Tracks the page's network activity from before the act until the settle is
 * done. Start it before the act so requests the act fires are counted.
 */
export class ActivityTracker {
  private inflight = new Map<Request, number>();
  private lastActivity = Date.now();
  private readonly onRequest = (req: Request) => {
    if (!this.counts(req)) return;
    this.inflight.set(req, Date.now());
    this.lastActivity = Date.now();
  };
  private readonly onDone = (req: Request) => {
    if (this.inflight.delete(req)) this.lastActivity = Date.now();
  };

  constructor(
    private readonly context: BrowserContext,
    private readonly page: () => Page,
  ) {}

  start(): this {
    this.context.on('request', this.onRequest);
    this.context.on('requestfinished', this.onDone);
    this.context.on('requestfailed', this.onDone);
    return this;
  }

  stop(): void {
    this.context.off('request', this.onRequest);
    this.context.off('requestfinished', this.onDone);
    this.context.off('requestfailed', this.onDone);
    this.inflight.clear();
  }

  /** Count the act's own page only, and not the long-lived request types. */
  private counts(req: Request): boolean {
    if (IGNORED_TYPES.has(req.resourceType())) return false;
    try {
      return req.frame().page() === this.page();
    } catch {
      return false; // a service-worker request has no frame
    }
  }

  /** Requests still pending, not counting long polls. */
  pending(now = Date.now()): number {
    let n = 0;
    for (const started of this.inflight.values()) if (now - started < LONG_POLL_MS) n++;
    return n;
  }

  /** Mark activity now (the act itself just ran). */
  touch(): void {
    this.lastActivity = Date.now();
  }

  msSinceActivity(now = Date.now()): number {
    return now - this.lastActivity;
  }
}

/**
 * Start a mutation clock in the page (idempotent per document). Records when
 * the DOM last changed. A symbol-keyed slot, so it can't clash with page code.
 */
export async function armMutationClock(page: Page): Promise<void> {
  await page
    .evaluate((key) => {
      const slot = Symbol.for(key);
      const w = window as unknown as Record<symbol, number | undefined>;
      if (w[slot] !== undefined) return;
      w[slot] = performance.now();
      new MutationObserver(() => {
        w[slot] = performance.now();
      }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    }, MUTATION_KEY)
    .catch(() => {});
}

/** Milliseconds since the DOM last changed, or null when no clock runs (a new document). */
async function msSinceMutation(page: Page): Promise<number | null> {
  try {
    return await page.evaluate((key) => {
      const t = (window as unknown as Record<symbol, number | undefined>)[Symbol.for(key)];
      return t === undefined ? null : performance.now() - t;
    }, MUTATION_KEY);
  } catch {
    return null; // mid-navigation: the context is gone
  }
}

const POLL_MS = 75;

/**
 * Wait until the page is quiet, per the timing. Returns how long it took and
 * whether it actually went quiet (false means the cap was hit).
 */
export async function settlePage(
  page: () => Page,
  tracker: ActivityTracker,
  timing: SettleTiming,
): Promise<{ settled: boolean; ms: number }> {
  const start = Date.now();
  tracker.touch();
  for (;;) {
    const now = Date.now();
    const elapsed = now - start;
    if (elapsed >= timing.maxMs) return { settled: false, ms: elapsed };
    if (elapsed >= timing.floorMs && tracker.pending(now) === 0 && tracker.msSinceActivity(now) >= timing.quietMs) {
      const active = page();
      const sinceMutation = await msSinceMutation(active);
      if (sinceMutation === null) {
        // A document the clock isn't running in yet (the act navigated). Start
        // it, and give the new page one quiet window from here.
        await armMutationClock(active);
        tracker.touch();
      } else if (sinceMutation >= timing.quietMs) {
        return { settled: true, ms: Date.now() - start };
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
