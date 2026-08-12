import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { decks } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { getActiveDeckForDate, getLatestDeck } from '@/lib/db/queries';
import { ensureTodaysDeck } from '@/lib/deck/ensure-todays-deck';
import { ensureCalendarProvider } from '@/lib/deck/calendar-connector';
import { todayLocalDate } from '@/lib/deck/date';
import { withCompression } from '@/lib/api/compression';

// First-look generation can run the AI pipeline (two model calls).
export const maxDuration = 60;

// Compressed: this route can ship hundreds of KB of JSON, and Next 16
// does not compress route handlers. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const limit = parseInt(params.get('limit') ?? '1', 10);

    // Multi-deck reads are raw history — never trigger generation.
    if (limit !== 1) {
      const db = getDb();
      const results = db
        .select()
        .from(decks)
        .orderBy(desc(decks.createdAt))
        .limit(limit)
        .all();
      return Response.json(results);
    }

    // Default single read: lazily ensure today's deck exists (the proactive
    // first-look guarantee), unless explicitly opted out with ?ensure=false.
    // Degrade gracefully — the common read must never 500 just because
    // generation can't run (e.g. no OPENAI_API_KEY). Fall back to today's
    // active deck if one already exists, else the latest deck of any day so
    // the client can still render something (and tell, via forDate, that it
    // isn't today's).
    const ensure = params.get('ensure') !== 'false';
    if (ensure) {
      try {
        ensureCalendarProvider();
        const deck = await ensureTodaysDeck();
        return Response.json(deck);
      } catch (err) {
        console.error('[GET /api/deck] ensureTodaysDeck failed, returning latest', err);
        return Response.json(getActiveDeckForDate(todayLocalDate()) ?? getLatestDeck());
      }
    }

    return Response.json(getActiveDeckForDate(todayLocalDate()) ?? getLatestDeck());
  } catch (err) {
    console.error('[GET /api/deck]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
