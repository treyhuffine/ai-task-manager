import { ensureCalendarProvider } from '@/lib/deck/calendar-connector';
import { reconcileDeckWithExternalChanges } from '@/lib/deck/reconcile-external';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Re-check today's deck against the live calendar and adapt it to external
 * changes (a new meeting shrinks the day → bump the lowest-priority item,
 * narrated + reversible). Deterministic, no model call. A heartbeat or the
 * scheduler calls this on a cadence; no-op until a calendar connector exists.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    ensureCalendarProvider();
    const body = rpcInput.body;
    const result = await reconcileDeckWithExternalChanges({ inFocus: !!body?.inFocus });
    return reply(result);
  } catch (err) {
    console.error('[POST /api/deck/reconcile]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ inFocus: rpcZ.boolean().optional() }).strict().default({}) }).strict();
