import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { UpdateTaskInput } from '@/db/types';
import { upsertEmbedding, buildEmbeddingText, deleteEmbedding } from '@/lib/embeddings/embed';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const row = db.select().from(tasks).where(eq(tasks.id, id)).get();

    if (!row) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    // Fire-and-forget: mark as viewed
    db.update(tasks)
      .set({ last_viewed_at: new Date().toISOString() })
      .where(eq(tasks.id, id))
      .run();

    return Response.json(row);
  } catch (err) {
    console.error('[GET /api/tasks/:id]', err);
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
    const body: UpdateTaskInput = await request.json();

    const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!existing) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    const row = db
      .update(tasks)
      .set({ ...body, updated_at: new Date().toISOString() })
      .where(eq(tasks.id, id))
      .returning()
      .get();

    void upsertEmbedding('task', row.id, buildEmbeddingText('task', row));
    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/tasks/:id]', err);
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
    const result = db.delete(tasks).where(eq(tasks.id, id)).run();

    if (result.changes === 0) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    deleteEmbedding('task', id);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[DELETE /api/tasks/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
