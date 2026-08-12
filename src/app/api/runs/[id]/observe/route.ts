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
import { withCompression } from '@/lib/api/compression';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(_request: NextRequest, ctx: RouteContext) {
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
