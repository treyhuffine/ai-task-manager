import type { NextRequest } from 'next/server';
import {
  getAgent,
  getChatEventById,
  getChatSessionWithExecution,
  insertChatEvent,
  materializeEventRefs,
} from '@/lib/db/queries';
import { budgetGate } from '@/lib/runs/budget';
import { deriveAndSetSessionLabel } from '@/lib/sessions/derive-label';
import { expandMarkers } from '@/lib/attachments/expand-markers';
import { expandEntityMarkers } from '@/lib/entity-refs/expand-markers';
import * as executor from '@/lib/executor/adapter';
import { healthCheckSession } from '@/lib/executor/health';
import type { Attachment } from '@/db/types';

interface PostBody {
  content?: string;
  /**
   * Files attached to this message — same `Attachment` shape as
   * tasks/notes/areas use. Marker tokens in `content`
   * (`[[file:<fileName>]]`) point at entries here. The shape (no
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

    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (session.status === 'archived') {
      // Stale state — `ExecutionView` auto-resumes archived sessions on
      // mount via `useContinueSession`, so the canonical UI flow never
      // reaches this branch. Hitting it means the client raced ahead of
      // the resume mutation (or this is a direct API call from a stale
      // tab). Reject cleanly; the frontend's session invalidation will
      // catch it on the next refetch.
      return Response.json({ error: 'Cannot send to an archived session' }, { status: 400 });
    }
    if (session.takeoverStartedAt) {
      return Response.json(
        {
          error: 'session_in_takeover',
          message:
            'Session is being worked on locally. Run `flow resume` or click Done in the takeover banner before sending more messages.',
        },
        { status: 409 },
      );
    }

    // Skip pre-flight for retries (client re-POSTs the same body.id
    // after a transient failure). The original send already cleared
    // the gates; rejecting the retry here would surface a 409 to the
    // user while their original message is still in flight inside the
    // executor — confusing and wrong. The orphan-healing path below
    // (via `healthCheckSession`) handles the actual re-dispatch
    // decision. `getChatEventById` is a cheap PK lookup.
    const isExistingRetry = !!(body.id && getChatEventById(body.id));

    // We deliberately do NOT gate manual sends on a run already in
    // flight against this execution. Concurrent sends are a first-class
    // feature — the composer accepts them mid-turn and the provider's
    // native queue absorbs them (Claude drains them as `<system-reminder>`
    // attachments on the next tool result; Codex merges them into the
    // active turn). The earlier execution-level mutex pre-flight rejected
    // a user's own in-flight turn with a misleading "a scheduled run is in
    // flight" 409 — it couldn't tell the user's own `trigger='manual'` run
    // apart from a real peer/scheduled one. Schedule-vs-schedule worktree
    // contention is still governed separately by each schedule's
    // `concurrencyPolicy` in `runs/dispatch.ts`; that path is untouched.
    //
    // Budget is the one pre-flight that remains. The executor's `dispatch`
    // is fire-and-forget below, so a throw there only lands as a server-
    // side log while the client gets a (false) 201 and shows a "sent"
    // message the agent never saw. Surfacing the budget block at request
    // time keeps the UI honest. Skipped on retry — see above.
    if (!isExistingRetry) {
      if (budgetGate() === 'block') {
        return Response.json(
          {
            error: 'budget_exceeded',
            message:
              'Monthly budget exceeded. Raise the budget in Settings, or re-send with the explicit over-budget confirmation.',
          },
          { status: 402 },
        );
      }
    }

    // Persist the user event with the *marker* version of content. The
    // expanded version (with paste content inlined) goes only to the
    // agent — keeping the row compact prevents giant pastes from
    // bloating the events cache. The transcript renderer parses markers
    // out and substitutes file chips on render.
    //
    // PK conflict path: the client-minted `id` is the optimistic-UI
    // primary key, so retries (useRetrySend) carry the same id as the
    // original send. `insertChatEvent` uses `onConflictDoNothing`, so
    // a re-POST of an already-persisted row returns null. That's not
    // a failure — fetch the existing row and return 201 to match the
    // DB's idempotent semantics on the HTTP boundary. The dispatch
    // decision happens below: on retry we delegate to the health
    // check's orphan logic instead of unconditionally firing.
    const inserted = insertChatEvent({
      id: body.id,
      sessionId: id,
      role: 'user',
      source: 'user',
      content,
      attachments,
      createdAt: new Date().toISOString(),
    });
    const isRetry = inserted === null;
    const row = inserted ?? (body.id ? getChatEventById(body.id) : null);
    if (!row) {
      // Insert reported a conflict but the row isn't queryable —
      // means a write torn between sessions or schema drift.
      return Response.json({ error: 'failed to persist user message' }, { status: 500 });
    }

    // Materialize entity references (task/note/scratchpad) into chat_refs
    // so reverse-lookup UIs ("which sessions reference this note?") and
    // the references slide-over both work. Idempotent on retries.
    if (!isRetry) {
      try {
        materializeEventRefs(row.id, id, content);
      } catch (err) {
        console.warn(`[POST /api/sessions/:id/messages] materializeEventRefs failed:`, err);
      }
    }

    // Expand markers once, off the response path. Both label derivation
    // and the agent dispatch use the same expanded prompt. Two passes:
    // entity markers (task / note / scratchpad) first — they expand to
    // inline `<task>` / `<note>` / `<scratchpad>` tags. File markers
    // second — they expand to absolute paths or `<attachment>` text.
    const entityExpanded = expandEntityMarkers(content, id);
    const expanded = await expandMarkers(entityExpanded, attachments);
    // First-message titling is for task-shaped threads (executions, content):
    // their first message IS the intent. Orchestration chats are
    // relationship-shaped — intent drifts, so they stay unlabeled while live
    // and get a retrospective summary at archive time instead
    // (`deriveRetrospectiveLabel`). See docs/orchestrator-harness.md.
    if (!session.label && !isRetry && session.type !== 'orchestration') {
      const agent = getAgent(session.agentId);
      void deriveAndSetSessionLabel(id, expanded, agent?.harness ?? 'claude_code');
    }

    // Self-heal in-memory state before dispatch. Catches the dead
    // cached `agentSession` case so the next send doesn't silently
    // throw "Session is closed."
    //
    // On a fresh send: `redispatchOrphans:false` because this route
    // is about to dispatch the same content — letting health also
    // dispatch would double-fire.
    //
    // On a retry (PK conflict): `redispatchOrphans:true`. The row
    // already existed, so we DON'T fire route-level dispatch below;
    // instead we delegate to health's orphan logic which correctly
    // distinguishes "original dispatch never ran" (subprocess dead →
    // redispatch) from "original dispatch still mid-flight"
    // (subprocess alive → leave alone).
    try {
      await healthCheckSession(id, { redispatchOrphans: isRetry });
    } catch (err) {
      console.error(`[POST /api/sessions/:id/messages] pre-send health check failed for ${id}:`, err);
    }

    // Dispatch the *expanded* content to the agent. Fire-and-forget;
    // failures surface via logs and the runtime-status indicator.
    // Skip on retry — the health check already decided whether to
    // redispatch via the orphan path.
    if (!isRetry) {
      executor.dispatch(id, expanded).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[POST /api/sessions/:id/messages] dispatch failed for ${id}:`, msg);
      });
    }

    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/sessions/:id/messages]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
