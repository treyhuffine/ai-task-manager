import { NextRequest } from 'next/server';
import { getChatSessionWithExecution, listChatSessions } from '@/lib/db/queries';
import { sortSessionsHotnessDesc } from '@/lib/utils/session-sort';

/**
 * Past + current chats for the execution that `:id` belongs to, hottest first.
 * Powers the execution view's chat-history dropdown — resuming an entry is just
 * navigating to it (the view auto-continues an archived chat on open).
 *
 * Sorting goes through `sortSessionsHotnessDesc` rather than trusting
 * `listChatSessions`'s SQL `ORDER BY`. The SQL compares
 * `COALESCE(lastOutcomeEventAt, startedAt)` as raw strings, but those two
 * columns use different formats (ISO vs SQLite space-format) and ' ' < 'T',
 * so a brand-new chat sinks below the day's older ones. The shared util
 * normalizes to epoch ms and folds in `unreadMarkerAt` — the same hotness the
 * rail sorts by.
 *
 * `unreadMarkerAt` / `lastViewedAt` ride along so the dropdown can run
 * `isSessionUnread` client-side without a second round trip.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const current = getChatSessionWithExecution(id);
    if (!current) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!current.executionId) return Response.json({ sessions: [] });

    const chats = listChatSessions({ executionId: current.executionId });
    const sessions = sortSessionsHotnessDesc(chats).map((s) => ({
      id: s.id,
      label: s.label,
      status: s.status,
      startedAt: s.startedAt,
      lastOutcomeEventAt: s.lastOutcomeEventAt,
      unreadMarkerAt: s.unreadMarkerAt,
      lastViewedAt: s.lastViewedAt,
      isCurrent: s.id === id,
    }));
    return Response.json({ sessions });
  } catch (err) {
    console.error('[GET /api/sessions/:id/history]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
