/**
 * The change-router — the "chief of staff / communications bodyguard" policy.
 *
 * Every change that the world (or a reconcile) proposes to the deck flows
 * through here, and the router decides how loudly to surface it:
 *
 *   - absorb    — silent. The deck reflects it; it's discoverable in the
 *                 bumped lane / change log, but nothing is pushed. The default.
 *   - digest    — calm. Summarized at a natural seam (the change brief).
 *   - interrupt — now. Pierces focus. Reserved and rare: only when a change
 *                 BOTH needs a decision only the user can make AND can't wait.
 *
 * This is a pure module (no I/O) so it's exhaustively testable. It's
 * source-agnostic by design: calendar deltas today, Slack/email/reassignments
 * later all route through the same policy.
 */

import type { DeckChange } from '@/db/types';

export type ChangeChannel = 'absorb' | 'digest' | 'interrupt';

/** Target for a calm day. More than this and the thresholds are miscalibrated. */
export const DEFAULT_INTERRUPT_BUDGET = 2;

/** A change being considered for surfacing, with routing signals attached. */
export interface ProposedChange {
  kind: DeckChange['kind'];
  taskId: string;
  reason: string;
  source: DeckChange['source'];
  /** Only the user can resolve this (e.g. a hard-deadline task lost its slot). */
  needsDecision?: boolean;
  /** Acting at the next calm seam would cost something real (a missed window). */
  timeSensitive?: boolean;
  /** Touches a hard-deadline or explicitly-prioritized item. */
  touchesPriority?: boolean;
  magnitude?: 'minor' | 'notable' | 'major';
}

export interface RouterContext {
  /** The user is heads-down in a focus block. */
  inFocus: boolean;
  /** Interrupts already fired today (the budget is per-day). */
  interruptsToday: number;
  /** Max interrupts/day before interrupt-worthy changes downgrade to digest. */
  interruptBudget?: number;
  /** Change kinds the user keeps dismissing — demoted toward silent (learned). */
  mutedKinds?: ReadonlySet<DeckChange['kind']>;
}

export interface RouterDecision {
  channel: ChangeChannel;
  reason: string;
}

/** Classify a single proposed change into a surfacing channel. */
export function routeChange(change: ProposedChange, ctx: RouterContext): RouterDecision {
  const budget = ctx.interruptBudget ?? DEFAULT_INTERRUPT_BUDGET;

  // Learned demotion: a muted kind never rises above silent.
  if (ctx.mutedKinds?.has(change.kind)) {
    return { channel: 'absorb', reason: 'muted: you routinely dismiss this kind' };
  }

  const wantsInterrupt = !!change.needsDecision && !!change.timeSensitive;

  if (wantsInterrupt) {
    // Budget guard — a calm day should survive on zero interrupts.
    if (ctx.interruptsToday >= budget) {
      return { channel: 'digest', reason: 'interrupt-worthy, but the daily interrupt budget is spent' };
    }
    // Focus bodyguard — in a focus block, only a true fire (major) pierces;
    // lesser interrupt-worthy changes wait for the next break.
    if (ctx.inFocus && change.magnitude !== 'major') {
      return { channel: 'digest', reason: 'held: you’re in a focus block, will surface at your next break' };
    }
    return { channel: 'interrupt', reason: 'needs your decision and can’t wait' };
  }

  // Not interrupt-worthy → digest if notable, else absorb silently.
  const notable =
    change.magnitude === 'notable' ||
    change.magnitude === 'major' ||
    change.touchesPriority === true ||
    change.kind === 'bumped' ||
    change.kind === 'deferred' ||
    change.kind === 'dropped';

  if (notable) {
    return { channel: 'digest', reason: 'worth knowing, surfaced at a calm moment' };
  }
  return { channel: 'absorb', reason: 'handled cleanly, discoverable, not pushed' };
}

export interface RoutedChange {
  change: ProposedChange;
  decision: RouterDecision;
}

/**
 * Route a batch, consuming the interrupt budget across the batch so a single
 * reconcile can't fire ten interrupts at once (batching = anti-firehose).
 */
export function routeChanges(changes: ProposedChange[], ctx: RouterContext): RoutedChange[] {
  let fired = ctx.interruptsToday;
  return changes.map((change) => {
    const decision = routeChange(change, { ...ctx, interruptsToday: fired });
    if (decision.channel === 'interrupt') fired++;
    return { change, decision };
  });
}
