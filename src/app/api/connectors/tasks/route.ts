import type { NextRequest } from 'next/server';
import { listConnectorTasks } from '@/lib/connectors/task-sources';

/**
 * Tasks from connected task-management providers (Todoist, Linear).
 *
 * Read-only and app-initiated — see `task-sources.ts` for why this bypasses the
 * agent tool path and calls the connector engine directly. Providers that fail
 * come back in `failures` rather than failing the whole request, so one dead
 * connection degrades to a note instead of an empty launcher group.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q') ?? '';
    return Response.json(await listConnectorTasks(query));
  } catch (err) {
    console.error('[GET /api/connectors/tasks]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
