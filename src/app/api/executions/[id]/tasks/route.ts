import type { NextRequest } from 'next/server';
import { getExecutionTasks } from '@/lib/db/queries';

/**
 * The tasks associated with an execution (its workstream), newest association
 * first. Used to show what a workstream is working — one task or several. Returns
 * a compact shape (id / title / status); an empty array for taskless quick work.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tasks = getExecutionTasks(id).map((t) => ({ id: t.id, title: t.title, status: t.status }));
    return Response.json(tasks);
  } catch (err) {
    console.error('[GET /api/executions/:id/tasks]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
