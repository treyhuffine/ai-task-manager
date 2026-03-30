import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { notes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { UpdateNoteInput } from '@/db/types';
import { upsertEmbedding, buildEmbeddingText, deleteEmbedding } from '@/lib/embeddings/embed';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const row = db.select().from(notes).where(eq(notes.id, id)).get();

    if (!row) {
      return Response.json({ error: 'Note not found' }, { status: 404 });
    }

    // Fire-and-forget: mark as viewed
    db.update(notes)
      .set({ last_viewed_at: new Date().toISOString() })
      .where(eq(notes.id, id))
      .run();

    return Response.json(row);
  } catch (err) {
    console.error('[GET /api/notes/:id]', err);
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
    const body: UpdateNoteInput = await request.json();

    const existing = db.select().from(notes).where(eq(notes.id, id)).get();
    if (!existing) {
      return Response.json({ error: 'Note not found' }, { status: 404 });
    }

    const row = db
      .update(notes)
      .set({ ...body, updated_at: new Date().toISOString() })
      .where(eq(notes.id, id))
      .returning()
      .get();

    void upsertEmbedding('note', row.id, buildEmbeddingText('note', row));
    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/notes/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const result = db.delete(notes).where(eq(notes.id, id)).run();

    if (result.changes === 0) {
      return Response.json({ error: 'Note not found' }, { status: 404 });
    }

    deleteEmbedding('note', id);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[DELETE /api/notes/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
