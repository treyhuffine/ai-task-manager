import { getActiveDeckForDate, getLatestDeck, listDecks } from '@/lib/db/queries';
import { ensureCalendarProvider } from '@/lib/deck/calendar-integration';
import { todayLocalDate } from '@/lib/deck/date';
import { ensureTodaysDeck } from '@/lib/deck/ensure-todays-deck';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

// First-look generation can run the AI pipeline (two model calls).

// Compressed: this route can ship hundreds of KB of JSON, and Next 16
// does not compress route handlers. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  try {
    const params = searchParams(rpcInput.query);
    const limit = parseInt(params.get('limit') ?? '1', 10);

    if (limit !== 1) return reply(listDecks(limit));
    return CURRENT(rpcInput, request);
  } catch (err) {
    return reply({ error: String(err) }, { status: 500 });
  }
}

export async function CURRENT(rpcInput: rpcZ.infer<typeof CURRENTInput>, _request: OperationContext) {
  const params = searchParams(rpcInput.query);
  try {
    // Default single read: lazily ensure today's deck exists (the proactive
    // first-look guarantee), unless explicitly opted out with ?ensure=false.
    // Degrade gracefully — the common read must never 500 just because
    // generation can't run (e.g. no agent harness CLI). Fall back to today's
    // active deck if one already exists, else the latest deck of any day so
    // the client can still render something (and tell, via forDate, that it
    // isn't today's).
    const ensure = params.get('ensure') !== 'false';
    if (ensure) {
      try {
        ensureCalendarProvider();
        const deck = await ensureTodaysDeck();
        return reply(deck);
      } catch (err) {
        console.error('[GET /api/deck] ensureTodaysDeck failed, returning latest', err);
        return reply(getActiveDeckForDate(todayLocalDate()) ?? getLatestDeck());
      }
    }

    return reply(getActiveDeckForDate(todayLocalDate()) ?? getLatestDeck());
  } catch (err) {
    console.error('[GET /api/deck]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "limit": rpcZ.string().optional(), "ensure": rpcZ.string().optional() }).strict().optional() }).strict().default({});

export const CURRENTInput = rpcZ.object({ query: rpcZ.object({ ensure: rpcZ.string().optional() }).strict().optional() }).strict().default({});
