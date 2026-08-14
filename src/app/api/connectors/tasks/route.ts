import type { NextRequest } from 'next/server';
import { listConnectorTasks } from '@/lib/connectors/task-sources';
import { withCompression } from '@/lib/api/compression';

/**
 * Tasks from connected task-management providers (Todoist, Linear).
 *
 * Read-only and app-initiated — see `task-sources.ts` for why this bypasses the
 * agent tool path and calls the connector engine directly. Providers that fail
 * come back in `failures` rather than failing the whole request, so one dead
 * connection degrades to a note instead of an empty launcher group.
 */
export const dynamic = 'force-dynamic';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const query = params.get('q') ?? '';
    // Per provider, not overall — the launcher renders one group each, so a
    // shared budget would let a chatty provider starve a quiet one. Grows as
    // the user pages through a group; clamped so a hand-written URL can't ask
    // a provider for its entire backlog.
    const limitRaw = parseInt(params.get('limit') ?? '', 10);
    const limitPerProvider = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 200)
      : undefined;
    return Response.json(await listConnectorTasks(query, { limitPerProvider }));
  } catch (err) {
    console.error('[GET /api/connectors/tasks]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
