import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { stream } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { UpdateStreamInput } from '@/db/types';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const body: UpdateStreamInput = await request.json();

    const existing = db.select().from(stream).where(eq(stream.id, id)).get();
    if (!existing) {
      return Response.json({ error: 'Stream item not found' }, { status: 404 });
    }

    const row = db
      .update(stream)
      .set(body)
      .where(eq(stream.id, id))
      .returning()
      .get();

    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/stream/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
