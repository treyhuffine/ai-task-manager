import type { NextRequest } from 'next/server';
import { listSessionsWithPending } from '@/lib/executor/pending-input';
import { withCompression } from '@/lib/api/compression';

/**
 * Snapshot of every session that currently has at least one pending input
 * registered (permission prompt or AskUserQuestion blocking the agent).
 * Used by the rail on first mount to seed its "Needs Approval" bucket;
 * subsequent updates arrive over the global SSE channel.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(_request: NextRequest) {
  try {
    return Response.json({ sessionIds: listSessionsWithPending() });
  } catch (err) {
    console.error('[GET /api/sessions/pending-input]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
