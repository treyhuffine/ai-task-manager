import type { NextRequest } from 'next/server';
import { completeTask } from '@/lib/db/queries';
import { isTaskLifecycleError, LIFECYCLE_ERROR_HTTP_STATUS } from '@/lib/tasks/lifecycle';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const result = completeTask(id, {
      note: body.note,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
      expectedRevision: typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
      meta: { source: 'human' },
    });

    if (!result) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    return Response.json(result);
  } catch (err) {
    if (isTaskLifecycleError(err)) {
      return Response.json({ error: err.message, code: err.code, details: err.details }, { status: LIFECYCLE_ERROR_HTTP_STATUS[err.code] });
    }
    console.error('[POST /api/tasks/:id/complete]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
