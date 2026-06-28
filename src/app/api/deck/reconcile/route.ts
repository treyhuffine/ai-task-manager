import { NextRequest } from 'next/server';
import { reconcileDeckWithExternalChanges } from '@/lib/deck/reconcile-external';
import { ensureCalendarProvider } from '@/lib/deck/calendar-connector';

/**
 * Re-check today's deck against the live calendar and adapt it to external
 * changes (a new meeting shrinks the day → bump the lowest-priority item,
 * narrated + reversible). Deterministic, no model call. A heartbeat or the
 * scheduler calls this on a cadence; no-op until a calendar connector exists.
 */
export async function POST(request: NextRequest) {
  try {
    ensureCalendarProvider();
    const body = await request.json().catch(() => ({}));
    const result = await reconcileDeckWithExternalChanges({ inFocus: !!body?.inFocus });
    return Response.json(result);
  } catch (err) {
    console.error('[POST /api/deck/reconcile]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
