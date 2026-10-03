import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/calendar?start=YYYY-MM-DD&days=N[&fresh=1]
 *
 * The normalized day shape for a date range: events, gaps, free minutes, and
 * provider/freshness status. Reads the connectors directly (no DB tables), so
 * it bypasses the queries layer by design. `start` defaults to today, `days`
 * clamps to 1-14, `fresh=1` busts the 60s service cache.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const sp = searchParams(rpcInput.query);
    const start = sp.get('start') ?? undefined;
    if (start !== undefined && !DATE_RE.test(start)) {
      return reply({ error: 'start must be YYYY-MM-DD' }, { status: 400 });
    }
    const daysRaw = Number.parseInt(sp.get('days') ?? '1', 10);
    const days = Number.isNaN(daysRaw) ? 1 : daysRaw;
    const fresh = sp.get('fresh') === '1';

    // Lazy: the service reaches the connectors runtime — load on demand.
    const { getCalendarRange } = await import('@/lib/calendar/service');
    const result = await getCalendarRange({ start, days, fresh });
    return reply(result);
  } catch (err) {
    console.error('[GET /api/calendar]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "start": rpcZ.string().optional(), "days": rpcZ.string().optional(), "fresh": rpcZ.string().optional() }).strict().optional() }).strict().default({});
