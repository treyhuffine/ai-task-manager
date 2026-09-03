import type { NextRequest } from 'next/server';
import { getTaskContinueTargets } from '@/lib/db/queries';

/**
 * Continue-with-agent targets for a task: its non-archived associated executions
 * that have a live session to resume ({ executionId, sessionId, label }). Zero
 * means launch a new execution, one means resume it, several means offer a
 * chooser. Archived executions are excluded (history, not Continue targets).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json(getTaskContinueTargets(id));
  } catch (err) {
    console.error('[GET /api/tasks/:id/continue-targets]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
