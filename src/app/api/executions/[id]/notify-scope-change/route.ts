import type { NextRequest } from 'next/server';
import { notifyExecutionScopeChange } from '@/lib/sessions/workstream-runtime';
import type { ScopeChange } from '@/lib/sessions/workstream';

const ACTIONS = new Set(['completed', 'archived', 'returned to Todo']);

/**
 * Tell a kept-running workstream that one of its associated tasks changed
 * lifecycle, so the agent stops pursuing that outcome. Server-side so the CLI/MCP
 * orchestrator can deliver it through the same control path REST uses. Body is a
 * {@link ScopeChange}.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Partial<ScopeChange>;
    if (typeof body.taskId !== 'string' || typeof body.taskTitle !== 'string' || !ACTIONS.has(String(body.action))) {
      return Response.json({ error: 'Invalid scope change payload.' }, { status: 422 });
    }
    notifyExecutionScopeChange(id, body as ScopeChange);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/executions/:id/notify-scope-change]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
