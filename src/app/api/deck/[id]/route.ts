import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { decks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { UpdateDeckInput } from '@/db/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getDb();
    const deck = db.select().from(decks).where(eq(decks.id, id)).get();

    if (!deck) {
      return Response.json({ error: 'Deck not found' }, { status: 404 });
    }

    return Response.json(deck);
  } catch (err) {
    console.error('[GET /api/deck/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: UpdateDeckInput = await request.json();
    const db = getDb();

    const deck = db
      .update(decks)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(decks.id, id))
      .returning()
      .get();

    if (!deck) {
      return Response.json({ error: 'Deck not found' }, { status: 404 });
    }

    return Response.json(deck);
  } catch (err) {
    console.error('[PATCH /api/deck/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
