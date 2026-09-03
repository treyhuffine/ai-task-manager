import type { NextRequest } from 'next/server';
import { stopExecutionAgent } from '@/lib/sessions/workstream-runtime';

/**
 * Stop the running agent turns for an execution, in the server process that
 * owns the live handles. Preserves the durable execution, worktree, chats, and
 * associations — this is a runtime stop, not an archive. Used by the CLI/MCP
 * orchestrator (which cannot touch the in-memory handles) via the server
 * control path, and reports failure honestly so the caller never claims the
 * agent stopped when it did not.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await stopExecutionAgent(id);
    return Response.json(result, { status: result.ok ? 200 : 409 });
  } catch (err) {
    console.error('[POST /api/executions/:id/stop-agent]', err);
    return Response.json({ ok: false, failures: [String(err)] }, { status: 500 });
  }
}
