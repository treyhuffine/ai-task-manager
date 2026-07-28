import { NextRequest } from 'next/server';
import { getChatSessionWithExecution, listChatSessions, archiveChatSession } from '@/lib/db/queries';

/**
 * Close (archive) ONE chat of an execution — the X on the chat tab strip.
 * The chat's harness process is torn down and the row flips to archived.
 * The execution, its worktree, and every sibling chat stay untouched:
 * this is "close the conversation", not "archive the execution" (that's
 * `POST /api/sessions/:id/archive`).
 *
 * Refuses to close the execution's last open chat (409 `last_chat`) — an
 * execution with zero open chats has no surface left to talk to it
 * through, and the rail's one-row-per-execution read keys off the most
 * recently active open chat. The tab strip mirrors this by hiding the X
 * on a lone tab.
 *
 * Idempotent: closing an already-archived chat is a no-op success, so a
 * double-click or a raced retry can't error.
 *
 * A closed chat isn't gone — it moves to the strip's "older" chip and the
 * history dropdown. Navigating back to it reactivates it (the view's
 * auto-resume + `continueExecutionSession`'s sibling-resume path).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const current = getChatSessionWithExecution(id);
    if (!current) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!current.executionId) {
      return Response.json({ error: 'Not an execution chat' }, { status: 400 });
    }
    if (current.status === 'archived') return Response.json({ ok: true });

    const siblings = listChatSessions({ executionId: current.executionId });
    const openOthers = siblings.filter((s) => s.id !== id && s.status === 'active');
    if (openOthers.length === 0) {
      return Response.json(
        { error: 'last_chat', message: 'This is the only open chat. Archive the execution instead.' },
        { status: 409 },
      );
    }

    // Archive the row FIRST (fast, and the source of truth the tab strip
    // refetches), then tear down the harness process in the background.
    // Awaiting `close()` here would block the response for seconds while
    // the subprocess winds down, so the tab would sit there looking dead
    // after the click — the archive is what matters for correctness, and a
    // stray late event into an already-archived chat is harmless (the
    // transcript is preserved; reopening resumes).
    archiveChatSession(id);
    const { close } = await import('@/lib/executor/adapter');
    void close(id).catch(() => {});
    const { deriveRetrospectiveLabel } = await import('@/lib/sessions/derive-label');
    void deriveRetrospectiveLabel(id);

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/close-chat]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
