import type { NextRequest } from 'next/server';
import { archiveWorkspace, listChatSessions } from '@/lib/db/queries';
import { killAllForOwner } from '@/lib/terminal/pty-manager';
import { terminalOwnerId } from '@/lib/terminal/owner';
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
    // restarts). Both are safe no-ops when nothing's live:
    //   - node-pty terminals, owned per execution (deduped — many chats
    //     share one execution, and killing an owner twice is wasted work)
    //   - the cached agent CLI subprocess, one per chat
    const sessions = listChatSessions({ workspaceId: id });
    for (const ownerId of new Set(sessions.map(terminalOwnerId))) killAllForOwner(ownerId);
    await Promise.all(sessions.map((s) => closeAgentSession(s.id)));
    return Response.json(row);
  } catch (err) {
    console.error('[POST /api/workspaces/:id/archive]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
