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

export async function GET() {
  try {
    const now = new Date();
    const today = sumRunCostSince(startOfDayUtcIso(now));
    const budget = budgetSnapshot(now);
    return Response.json({
      activeRuns: countActiveRuns(),
      todaySpend: today,
      monthSpend: budget.spend,
      budget: budget.budget,
      budgetFraction: budget.fraction,
      budgetState: budget.state,
    });
  } catch (err) {
    console.error('[GET /api/runs/stats]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
