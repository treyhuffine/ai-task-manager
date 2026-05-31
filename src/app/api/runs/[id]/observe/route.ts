/**
 * GET /api/runs/<id>/observe
 *
 * Structured live status for a run. Cheap — one DB read + a bounded
 * chat_events scan + a process-liveness peek. Safe to poll on a
 * few-second cadence. See `src/lib/runs/observe.ts` for the
 * classification semantics.
 */

import { NextRequest } from 'next/server';
import { observeRun, summarizeActivity } from '@/lib/runs/observe';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const observation = observeRun(id);
  if (!observation) {
    return Response.json({ error: 'run not found' }, { status: 404 });
  }
  return Response.json({
    ...observation,
    summary: summarizeActivity(observation),
  });
}
