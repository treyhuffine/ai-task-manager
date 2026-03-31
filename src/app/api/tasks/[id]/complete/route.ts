import type { NextRequest } from 'next/server';
import { completeTask } from '@/lib/db/queries';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const result = completeTask(id, body.note);

    if (!result) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    return Response.json(result);
  } catch (err) {
    console.error('[POST /api/tasks/:id/complete]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
