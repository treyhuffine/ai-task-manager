import type { NextRequest } from 'next/server';
import { archiveWorkspace, listChatSessions } from '@/lib/db/queries';
import { killAllForSession } from '@/lib/terminal/pty-manager';
import { close as closeAgentSession } from '@/lib/executor/adapter';

export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = archiveWorkspace(id);
    if (!row) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    // Reap every process tied to this workspace's sessions — archiving the
    // workspace orphans them otherwise (they outlive it until the server
    // restarts). Both are safe no-ops for sessions with nothing live:
    //   - node-pty terminals (killAllForSession)
    //   - the cached agent CLI subprocess (closeAgentSession)
    const sessionIds = listChatSessions({ workspaceId: id }).map((s) => s.id);
    for (const sid of sessionIds) killAllForSession(sid);
    await Promise.all(sessionIds.map((sid) => closeAgentSession(sid)));
    return Response.json(row);
  } catch (err) {
    console.error('[POST /api/workspaces/:id/archive]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
