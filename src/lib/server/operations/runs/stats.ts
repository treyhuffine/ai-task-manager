import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * GET /api/runs/stats
 *
 * Dashboard rollup for the TopHud indicators. Returns active-run count,
 * today's spend, this-month spend, and the budget gate state. Cheap
 * enough to poll on a few-second cadence (single-row aggregates), so
 * we don't bother with realtime push for this surface.
 */

import { countActiveRuns, sumRunCostSince } from '@/lib/db/queries';
import { budgetSnapshot } from '@/lib/runs/budget';

function startOfDayUtcIso(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0),
  ).toISOString();
}

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const now = new Date();
    const today = sumRunCostSince(startOfDayUtcIso(now));
    const budget = budgetSnapshot(now);
    return reply({
      activeRuns: countActiveRuns(),
      todaySpend: today,
      monthSpend: budget.spend,
      budget: budget.budget,
      budgetFraction: budget.fraction,
      budgetState: budget.state,
    });
  } catch (err) {
    console.error('[GET /api/runs/stats]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
