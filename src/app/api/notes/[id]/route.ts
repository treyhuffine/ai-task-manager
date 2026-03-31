import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { notes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getNote, updateNote, deleteNote } from '@/lib/db/queries';
import type { UpdateNoteInput } from '@/db/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const row = getNote(id);

    if (!row) {
      return Response.json({ error: 'Note not found' }, { status: 404 });
    }

    // Fire-and-forget: mark as viewed
    const db = getDb();
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
    const body: UpdateNoteInput = await request.json();

    const row = updateNote(id, body);
    if (!row) {
      return Response.json({ error: 'Note not found' }, { status: 404 });
    }

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
    const success = deleteNote(id);

    if (!success) {
      return Response.json({ error: 'Note not found' }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[DELETE /api/notes/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
