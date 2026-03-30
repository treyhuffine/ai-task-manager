import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { areas } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { UpdateAreaInput } from '@/db/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const row = db.select().from(areas).where(eq(areas.id, id)).get();

    if (!row) {
      return Response.json({ error: 'Area not found' }, { status: 404 });
    }

    return Response.json(row);
  } catch (err) {
    console.error('[GET /api/areas/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const body: UpdateAreaInput = await request.json();

    const existing = db.select().from(areas).where(eq(areas.id, id)).get();
    if (!existing) {
      return Response.json({ error: 'Area not found' }, { status: 404 });
    }

    const row = db
      .update(areas)
      .set({ ...body, updated_at: new Date().toISOString() })
      .where(eq(areas.id, id))
      .returning()
      .get();

    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/areas/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
