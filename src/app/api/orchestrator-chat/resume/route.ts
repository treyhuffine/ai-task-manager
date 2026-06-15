import type { NextRequest } from 'next/server';
import {
  getChatSession,
  listChatSessions,
  archiveChatSession,
  updateChatSession,
} from '@/lib/db/queries';

/**
 * Make a past orchestrator chat the current one.
 *
 * Archives the currently-active interactive session (closing its cached
 * harness process) and flips the target back to active. The harness side
 * resumes for free: the next send re-spawns via the session's persisted
 * `externalSessionId`, so the model picks the conversation up with full
 * context from its on-disk transcript.
 *
 * Mode note: spawn flags (MCP attachment, tool guards) are read from the
 * CURRENT `orchestratorMode` at dispatch — resuming a chat that originally
 * ran under a different mode continues it under the active mode.
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId } = (await request.json()) as { sessionId?: string };
    if (!sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const target = getChatSession(sessionId);
    if (!target || target.type !== 'orchestration' || target.createdByRunId !== null) {
      return Response.json({ error: 'Not an interactive orchestrator chat' }, { status: 404 });
    }

    const current = listChatSessions({ type: 'orchestration', status: 'active' }).find(
      (s) => s.createdByRunId === null,
    );
    if (current && current.id === target.id) {
      return Response.json({ session: target });
    }

    if (current) {
      const { close } = await import('@/lib/executor/adapter');
      await close(current.id).catch(() => {});
      archiveChatSession(current.id);
      // Retrospective title for the thread leaving the stage (fire-and-forget).
      const { deriveRetrospectiveLabel } = await import('@/lib/sessions/derive-label');
      void deriveRetrospectiveLabel(current.id);
    }

    const session =
      target.status === 'archived'
        ? updateChatSession(target.id, { status: 'active', archivedAt: null })
        : target;
    return Response.json({ session });
  } catch (err) {
    console.error('[POST /api/orchestrator-chat/resume]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
