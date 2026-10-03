import { getChatSessionWithExecution, listChatSessions } from '@/lib/db/queries';
import { hasBackgroundTasks, isRunning } from '@/lib/executor/adapter';
import { reply, type OperationContext } from '@/lib/server/operation';
import { sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import { z as rpcZ } from 'zod/v4';

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
 *
 * `running` is the executor's in-memory turn state (same source as
 * `/runtime-status`) so the tab strip can mark which parallel chats have
 * an agent actively working. Free — no DB read, no subprocess poke.
 */
// Compressed: this route can ship hundreds of KB of JSON, and Next 16
// does not compress route handlers. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _req: OperationContext) {
  const { id } = rpcInput.params;
  try {
    const current = getChatSessionWithExecution(id);
    if (!current) return reply({ error: 'Session not found' }, { status: 404 });
    if (!current.executionId) return reply({ sessions: [] });

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
      running: isRunning(s.id),
      // Background work still running after the turn ended. Not working.
      background: hasBackgroundTasks(s.id),
      tabSortKey: s.tabSortKey,
    }));
    return reply({ sessions });
  } catch (err) {
    console.error('[GET /api/sessions/:id/history]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
