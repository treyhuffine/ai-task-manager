import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getTask, updateTask, deleteTask } from '@/lib/db/queries';
import type { UpdateTaskInput } from '@/db/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const row = getTask(id);

    if (!row) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    // Fire-and-forget: mark as viewed
    const db = getDb();
    db.update(tasks)
      .set({ lastViewedAt: new Date().toISOString() })
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
    const body: UpdateTaskInput = await request.json();

    const row = updateTask(id, body);
    if (!row) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

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
    const success = deleteTask(id);

    if (!success) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[DELETE /api/tasks/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
