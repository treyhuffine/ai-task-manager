/**
 * Monthly spend ceiling for scheduled + manual runs. A small budget
 * keeps the AI from inadvertently torching the user's Anthropic
 * credit; thresholds are surfaced via TopHud (warn) and dispatch
 * (block).
 *
 * Three states drive everything:
 *   - 'ok'    — budget not set OR spend < 75% of limit; dispatch proceeds
 *   - 'warn'  — spend ∈ [75%, 100%); dispatch proceeds, UI shows a soft
 *               warning
 *   - 'block' — spend ≥ 100%; scheduled dispatch is rejected and the
 *               schedule is auto-paused; manual dispatch requires
 *               explicit user confirmation
 *
 * In-flight runs at the threshold finish normally — we gate *new*
 * dispatches only.
 */

import { getUserState, sumRunCostSince } from '@/lib/db/queries';

export type BudgetGateState = 'ok' | 'warn' | 'block';

export interface BudgetSnapshot {
  /** Monthly limit in USD, or null if no budget is configured. */
  budget: number | null;
  /** Running total since the first of the current month. */
  spend: number;
  /** Fraction of budget used (spend / budget). null when no budget. */
  fraction: number | null;
  /** Current gate state. */
  state: BudgetGateState;
}

/** First-of-current-month at 00:00 UTC. */
function firstOfMonthUtcIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0))
    .toISOString();
}

/** SUM(cost_usd) FROM runs WHERE started_at >= first of month. */
export function currentMonthSpend(now: Date = new Date()): number {
  return sumRunCostSince(firstOfMonthUtcIso(now));
}

/**
 * Compute the current state vs. budget. Reads `user_state.monthly_budget_usd`
 * and `runs` in two cheap queries.
 */
export function budgetSnapshot(now: Date = new Date()): BudgetSnapshot {
  const us = getUserState();
  const budget = us?.monthlyBudgetUsd ?? null;
  const spend = currentMonthSpend(now);
  if (budget == null || budget <= 0) {
    return { budget, spend, fraction: null, state: 'ok' };
  }
  const fraction = spend / budget;
  let state: BudgetGateState = 'ok';
  if (fraction >= 1) state = 'block';
  else if (fraction >= 0.75) state = 'warn';
  return { budget, spend, fraction, state };
}

/** Convenience for callers that only need the gate decision. */
export function budgetGate(now: Date = new Date()): BudgetGateState {
  return budgetSnapshot(now).state;
}

/**
 * Human-readable reason recorded on `schedules.disabledReason` when the
 * budget guard auto-pauses a schedule.
 */
export const BUDGET_DISABLED_REASON = 'budget_exceeded';
