import type { NextRequest } from 'next/server';
import { getAgent, getChatSession, insertChatEvent } from '@/lib/db/queries';
import { deriveAndSetSessionLabel } from '@/lib/sessions/derive-label';
import { expandMarkers } from '@/lib/attachments/expand-markers';
import * as executor from '@/lib/executor/adapter';
import type { Attachment } from '@/db/types';

interface PostBody {
  content?: string;
  /**
   * Files attached to this message — same `Attachment` shape as
   * tasks/notes/areas use. Marker tokens in `content`
   * (`[[file:<file_name>]]`) point at entries here. The shape (no
   * `content` field) reflects that the bytes already live on disk —
   * the upload happened via `POST /api/attachments` before submit.
   */
  attachments?: Attachment[];
  /**
   * Optional client-minted UUIDv7 for the resulting `chat_events` row.
   * When provided, the persisted row and any optimistic UI placeholder
   * the client already inserted share the same id, so the React
   * reconciler keeps the same DOM node when the POST resolves (no
   * unmount/remount flash). When omitted, the server mints a UUIDv7.
   */
  id?: string;
}

/**
 * Send a user message into an execution session.
 *
 * Fire-and-forget: persist the user row, kick off `executor.dispatch`,
 * return 201 immediately. Assistant text, tool calls, and the
 * run-completion event flow into `chat_events` from the adapter's
 * `onEvent` callback over the next seconds-to-minutes.
 *
 * Concurrent sends are handled by the provider (Claude: mid-turn
 * `<system-reminder>` drain; Codex: same-turn merge). The executor
 * exposes `isRunning(id)` for the UI's Stop/Send toggle, but the route
 * doesn't gate on it — the user can type follow-ups whenever they
 * want and they'll appear in the chat thread the instant they post.
 *
 * The one provider-level gate lives inside `executor.dispatch`: it
 * throws `already_running` if the harness's `capabilities.concurrentSend`
 * is false. Today's providers (claude, codex) both set it true, so this
 * is a no-op in practice; the throw exists so a future non-concurrent
 * provider doesn't silently double-send.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: PostBody = await request.json();
    const content = body.content?.trim();
    const attachments = body.attachments ?? [];
    if (!content) {
      return Response.json({ error: 'content is required' }, { status: 400 });
    }

    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (session.status === 'archived') {
      return Response.json({ error: 'Cannot send to an archived session' }, { status: 400 });
    }
    if (session.takeover_started_at) {
      return Response.json(
        {
          error: 'session_in_takeover',
          message:
            'Session is being worked on locally. Run `flow resume` or click Done in the takeover banner before sending more messages.',
        },
        { status: 409 },
      );
    }

    // Persist the user event with the *marker* version of content. The
    // expanded version (with paste content inlined) goes only to the
    // agent — keeping the row compact prevents giant pastes from
    // bloating the events cache. The transcript renderer parses markers
    // out and substitutes file chips on render.
    //
    // No external_event_id for in-app rows — the partial unique index
    // doesn't apply, so insertChatEvent always returns the row here.
    // Created_at is explicit ISO so chronological sort works against
    // agentex's StreamEvent timestamps.
    const row = insertChatEvent({
      id: body.id,
      session_id: id,
      role: 'user',
      source: 'user',
      content,
      attachments,
      created_at: new Date().toISOString(),
    });
    if (!row) {
      // User-message inserts have no unique-constraint, so this is
      // structurally unreachable. Guard anyway so the response is
      // type-safe and a future schema change can't silently 500.
      return Response.json({ error: 'failed to persist user message' }, { status: 500 });
    }

    // Expand markers once, off the response path. Both label
    // derivation and the agent dispatch use the same expanded prompt.
    const expanded = await expandMarkers(content, attachments);
    if (!session.label) {
      const agent = getAgent(session.agent_id);
      void deriveAndSetSessionLabel(id, expanded, agent?.harness ?? 'claude_code');
    }

    // Dispatch the *expanded* content to the agent. Fire-and-forget;
    // failures surface via logs and the runtime-status indicator.
    executor.dispatch(id, expanded).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[POST /api/sessions/:id/messages] dispatch failed for ${id}:`, msg);
    });

    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/sessions/:id/messages]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
