/**
 * When a downloaded release takes effect, by itself (docs/always-on-spec.md
 * section 7.2). One rule for every Home: 10 quiet minutes, a 1-minute heads-up,
 * never stopping running work, and at most one automatic update every 12 hours.
 * Kept free of I/O and clocks, so the rule is tested as it is written.
 */
const minutes = (value: number) => value * 60_000;
function setting(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
export const updateTiming = () => ({
  quietMs: setting('RI_UPDATE_QUIET_MS', minutes(10)),
  headsUpMs: setting('RI_UPDATE_HEADS_UP_MS', minutes(1)),
  holdMs: setting('RI_UPDATE_HOLD_MS', minutes(60)),
  spacingMs: setting('RI_UPDATE_SPACING_MS', minutes(12 * 60)),
  longWaitMs: setting('RI_UPDATE_LONG_WAIT_MS', minutes(24 * 60)),
});
export type UpdateTiming = ReturnType<typeof updateTiming>;

export interface TimingFacts {
  now: number;
  /** What an update would cut off right now. */
  work: string[];
  /** The last time someone used Ri: a window, or an agent connected over MCP. */
  lastUseAt: number;
  /** When the current quiet stretch could have begun at the earliest. */
  quietFrom: number;
  headsUpAt?: number;
  heldUntil?: number;
  lastAutomaticAt?: number;
}
export type TimingStep =
  | { step: 'wait'; reason: string }
  | { step: 'heads-up'; at: number }
  | { step: 'update' };

/** The person can read this, in Settings and in `ri status`. */
export const QUIET_REASON = 'a quiet moment';

export function nextTimingStep(facts: TimingFacts, timing: UpdateTiming = updateTiming()): TimingStep {
  const { now } = facts;
  if (facts.heldUntil && now < facts.heldUntil) return { step: 'wait', reason: 'you asked to update later' };
  if (facts.lastAutomaticAt && now - facts.lastAutomaticAt < timing.spacingMs) return { step: 'wait', reason: 'the next update window, since Ri updates by itself at most every 12 hours' };
  if (facts.work.length) return { step: 'wait', reason: facts.work.join(', ') };
  // A use during the heads-up cancels it, and the wait starts over.
  if (now - Math.max(facts.lastUseAt, facts.quietFrom) < timing.quietMs) return { step: 'wait', reason: QUIET_REASON };
  if (!facts.headsUpAt) return { step: 'heads-up', at: now };
  return now - facts.headsUpAt < timing.headsUpMs ? { step: 'heads-up', at: facts.headsUpAt } : { step: 'update' };
}
