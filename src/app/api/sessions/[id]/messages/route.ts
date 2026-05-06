import type { NextRequest } from 'next/server';
import { uuidv7 } from 'uuidv7';
import { getDb } from '@/lib/db';
import { chatEvents } from '@/lib/db/schema';
import { getAgent, getChatSession } from '@/lib/db/queries';
import { deriveAndSetSessionLabel } from '@/lib/sessions/derive-label';
import * as executor from '@/lib/executor/adapter';

/**
 * Send a user message into an execution session.
 *
 * Two writes happen:
 *   1. The user's message lands in `chat_events` synchronously — per
 *      `docs/chat-sessions.md`, the app owns the user write because
 *      agentex skips userMessage events from its stream.
 *   2. The executor adapter dispatches the message into the live
 *      AgentSession (or creates one on first turn). That's
 *      fire-and-forget from this handler — we return 201 immediately;
 *      assistant text, tool calls, and the run-completion event flow
 *      into `chat_events` from the adapter's onEvent callback over the
 *      next seconds-to-minutes. The client polls
 *      `/api/sessions/:id/events` to render them.
 *
 * Pre-flight `executor.isRunning` rejects double-sends with 409. The UI
 * disables the composer based on runtime-status to make this rare; the
 * server check is defense-in-depth.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: { content?: string } = await request.json();
    const content = body.content?.trim();
    if (!content) {
      return Response.json({ error: 'content is required' }, { status: 400 });
    }

    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (session.status === 'archived') {
      return Response.json({ error: 'Cannot send to an archived session' }, { status: 400 });
    }
    if (executor.isRunning(id)) {
      return Response.json(
        { error: 'already_running', message: 'A turn is already in flight for this session.' },
        { status: 409 },
      );
    }

    // No external_event_id for in-app rows; no source_part_index split. The
    // partial unique index on chat_events skips them so two user messages
    // can sit at the same created_at without colliding.
    //
    // We set created_at explicitly to ISO format so chronological sort
    // works correctly against agentex's StreamEvent timestamps (also ISO).
    // SQLite's datetime('now') default returns a different format that
    // string-compares wrong against ISO.
    const db = getDb();
    const row = db
      .insert(chatEvents)
      .values({
        id: uuidv7(),
        session_id: id,
        role: 'user',
        source: 'user',
        content,
        created_at: new Date().toISOString(),
      })
      .returning()
      .get();

    // First-message label derivation: when the session was created
    // without a label (the no-modal flow), the first user message
    // becomes the label. Tries AI summarization via the harness's
    // cheap model; falls back to truncation. Fire-and-forget so the
    // route response stays fast — the client polls the session row
    // and repaints when the label lands. Subsequent messages don't
    // overwrite it; the user can rename via PATCH /api/sessions/:id.
    if (!session.label) {
      const agent = getAgent(session.agent_id);
      void deriveAndSetSessionLabel(id, content, agent?.harness ?? 'claude_code');
    }

    // Fire-and-forget the agent dispatch. Sync precondition errors throw
    // immediately and become a rejected promise; we surface them via
    // logs (the route has already responded). The client sees the agent
    // never runs and recovers via the runtime-status indicator.
    executor.dispatch(id, content).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[POST /api/sessions/:id/messages] dispatch failed for ${id}:`, msg);
    });

    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/sessions/:id/messages]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
