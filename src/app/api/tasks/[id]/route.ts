import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getTask, updateTask, deleteTask } from '@/lib/db/queries';
import type { UpdateTaskInput } from '@/db/types';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
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

    // Generic PATCH updates content/metadata only. Lifecycle status changes go
    // through POST /api/tasks/:id/transition (or /complete) so history,
    // idempotency, and invariants hold. Reject a status here rather than
    // silently dropping it, so a mis-wired caller finds out.
    if ('status' in (body as Record<string, unknown>)) {
      return Response.json(
        {
          error: 'status is not editable via PATCH. Use POST /api/tasks/:id/transition or /complete.',
          code: 'invalid_transition',
        },
        { status: 422 },
      );
    }

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
