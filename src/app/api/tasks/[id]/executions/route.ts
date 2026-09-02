import type { NextRequest } from 'next/server';
import { getTaskExecutions } from '@/lib/db/queries';

/** The executions owning a task (newest first), trimmed for the UI. Powers the
 * active-agent warning ("an agent is working on this"). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const execs = getTaskExecutions(id).map((e) => ({ id: e.id, label: e.label, status: e.status }));
    return Response.json(execs);
  } catch (err) {
    console.error('[GET /api/tasks/:id/executions]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
