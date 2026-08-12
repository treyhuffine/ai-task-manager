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
import { withCompression } from '@/lib/api/compression';

function startOfDayUtcIso(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0),
  ).toISOString();
}

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
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
