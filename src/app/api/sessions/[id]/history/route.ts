import { NextRequest } from 'next/server';
import { getChatSessionWithExecution, listChatSessions } from '@/lib/db/queries';

/**
 * Past + current chats for the execution that `:id` belongs to, newest first.
 * Powers the execution view's chat-history dropdown — resuming an entry is just
 * navigating to it (the view auto-continues an archived chat on open).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const current = getChatSessionWithExecution(id);
    if (!current) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!current.executionId) return Response.json({ sessions: [] });

    const chats = listChatSessions({ executionId: current.executionId });
    const sessions = chats.map((s) => ({
      id: s.id,
      label: s.label,
      status: s.status,
      startedAt: s.startedAt,
      lastOutcomeEventAt: s.lastOutcomeEventAt,
      isCurrent: s.id === id,
    }));
    return Response.json({ sessions });
  } catch (err) {
    console.error('[GET /api/sessions/:id/history]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
