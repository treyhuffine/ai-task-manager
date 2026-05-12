import type { NextRequest } from 'next/server';
import { listSessionsWithPending } from '@/lib/executor/pending-input';

/**
 * Snapshot of every session that currently has at least one pending input
 * registered (permission prompt or AskUserQuestion blocking the agent).
 * Used by the rail on first mount to seed its "Needs Approval" bucket;
 * subsequent updates arrive over the global SSE channel.
 */
export async function GET(_request: NextRequest) {
  try {
    return Response.json({ sessionIds: listSessionsWithPending() });
  } catch (err) {
    console.error('[GET /api/sessions/pending-input]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
