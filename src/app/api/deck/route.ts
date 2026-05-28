import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { decks } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const params = request.nextUrl.searchParams;
    const limit = parseInt(params.get('limit') ?? '1', 10);

    const results = db
      .select()
      .from(decks)
      .orderBy(desc(decks.createdAt))
      .limit(limit)
      .all();

    // If requesting a single deck (default), return it directly
    if (limit === 1) {
      return Response.json(results[0] ?? null);
    }

    return Response.json(results);
  } catch (err) {
    console.error('[GET /api/deck]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
