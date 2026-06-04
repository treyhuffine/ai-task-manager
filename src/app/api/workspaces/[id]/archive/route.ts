import type { NextRequest } from 'next/server';
import { archiveWorkspace, listChatSessions } from '@/lib/db/queries';
import { killAllForSession } from '@/lib/terminal/pty-manager';

export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = archiveWorkspace(id);
    if (!row) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    // Reap PTYs for every session in this workspace — archiving the
    // workspace orphans them otherwise (they outlive it until the server
    // restarts). Safe no-op for sessions that never opened a terminal.
    for (const s of listChatSessions({ workspaceId: id })) killAllForSession(s.id);
    return Response.json(row);
  } catch (err) {
    console.error('[POST /api/workspaces/:id/archive]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
