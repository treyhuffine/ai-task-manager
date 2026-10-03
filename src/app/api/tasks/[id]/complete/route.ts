import type { NextRequest } from 'next/server';
import { completeTaskForViewer } from '@/lib/tasks/viewer-lifecycle';
import { type RuntimeChoice } from '@/lib/sessions/workstream';
import { isTaskLifecycleError, LIFECYCLE_ERROR_HTTP_STATUS } from '@/lib/tasks/lifecycle';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const choice: RuntimeChoice | undefined =
      body.runtimeChoice === 'keep_running' || body.runtimeChoice === 'stop_running_agent'
        ? body.runtimeChoice
        : undefined;
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined;
    const expectedStatusChangedCount = typeof body.expectedStatusChangedCount === 'number' ? body.expectedStatusChangedCount : undefined;
    const acknowledgedChildIds = Array.isArray(body.acknowledgedChildIds) ? body.acknowledgedChildIds : undefined;
    const acknowledgedExecutionIds = Array.isArray(body.acknowledgedExecutionIds) ? body.acknowledgedExecutionIds : undefined;

    const result = await completeTaskForViewer(id, {
      note: body.note, idempotencyKey, expectedStatusChangedCount,
      acknowledgedChildIds, acknowledgedExecutionIds, runtimeChoice: choice,
    });

    return Response.json(result);
  } catch (err) {
    if (isTaskLifecycleError(err)) {
      return Response.json({ error: err.message, code: err.code, details: err.details }, { status: LIFECYCLE_ERROR_HTTP_STATUS[err.code] });
    }
    console.error('[POST /api/tasks/:id/complete]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
