import type { NextRequest } from 'next/server';
import { subscribe, sessionChannel, type SessionStreamMessage } from '@/lib/realtime/bus';
import { listChatEventsAfter } from '@/lib/db/queries';
import * as executor from '@/lib/executor/adapter';
import { listForSession as listPendingForSession } from '@/lib/executor/pending-input';
import type { ChatEventRecord } from '@/db/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

/**
 * SSE frame. `id:` lets the browser's EventSource auto-send the value
 * back as `Last-Event-ID` on reconnect — that's what powers resume
 * without any client-side bookkeeping. `event:` lets the client target
 * a specific listener; multi-line data is one-line-encoded as JSON.
 */
function sse(event: string, data: unknown, id?: string): Uint8Array {
  const idLine = id ? `id: ${id}\n` : '';
  const payload = `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return encoder.encode(payload);
}

/**
 * Per-session realtime stream.
 *
 * Lifecycle on connect:
 *
 *   1. If the request has a `Last-Event-ID` header, replay every
 *      chat_events row with id > lastEventId for this session. This
 *      catches the client up after a reconnect without it having to
 *      issue a separate fetch.
 *   2. Subscribe to the bus channel `session:<id>`. Every published
 *      `chat_event` flows out as an SSE message tagged with its row
 *      id, so a future reconnect resumes exactly from the last frame
 *      the browser observed.
 *   3. Keep-alive ping every 25s so proxies/load-balancers don't drop
 *      the connection during idle stretches.
 *
 * Auth: cookie via the global proxy middleware (proxy.ts accepts the
 * session cookie set by /api/session; EventSource can't attach headers
 * but it sends cookies natively).
 *
 * Race note: subscribe() is called before the Last-Event-ID replay, so
 * any event published during the replay still arrives as a live frame.
 * The client dedups by event.id (UUIDv7), so the worst case is a
 * harmless duplicate frame that's immediately discarded.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  const lastEventId = request.headers.get('last-event-id');

  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: Uint8Array) => {
        try { controller.enqueue(chunk); } catch { /* closed */ }
      };

      const writeChatEvent = (event: ChatEventRecord) => {
        enqueue(sse('chat_event', event, event.id));
      };

      // Subscribe first — any message arriving while we read the
      // initial state still gets delivered. The client dedups
      // chat_events on id; runtime and pending_input are last-write-
      // wins per session so out-of-order arrivals are self-correcting
      // (the publish order matches the state-mutation order in-process).
      unsubscribe = subscribe(sessionChannel(sessionId), (message: SessionStreamMessage) => {
        switch (message.kind) {
          case 'chat_event': writeChatEvent(message.event); break;
          case 'runtime': enqueue(sse('runtime', { running: message.running })); break;
          case 'pending_input': enqueue(sse('pending_input', { pending: message.pending })); break;
          case 'reconcile':
            enqueue(sse('reconcile', { status: message.status, replayed: message.replayed }));
            break;
          case 'session_updated': break;
        }
      });

      // Resume replay. listChatEventsAfter caps at 1000 — a session
      // that's drifted further than that on the client almost certainly
      // wants a fresh snapshot via the GET /events route instead, which
      // the useSessionStream hook will trigger if the resume returns a
      // full page.
      if (lastEventId) {
        try {
          const missed = listChatEventsAfter(sessionId, lastEventId);
          for (const row of missed) writeChatEvent(row);
        } catch (err) {
          console.error(`[GET /api/sessions/${sessionId}/stream] resume failed:`, err);
        }
      }

      // Seed the client with the current ephemeral state. Both reads
      // are in-process module-state lookups (Set/Map) — sub-microsecond
      // and no DB hit. Saves the client from issuing two separate
      // snapshot fetches just to hydrate the runtime indicator and
      // pending-input overlay.
      enqueue(sse('runtime', { running: executor.isRunning(sessionId) }));
      enqueue(sse('pending_input', { pending: listPendingForSession(sessionId) }));
      enqueue(sse('ready', { sessionId }));

      // Idle ping; the colon-prefix is a comment line that EventSource
      // ignores but keeps the TCP connection warm against ~30s proxy
      // timeouts.
      keepAlive = setInterval(() => {
        enqueue(encoder.encode(`: ping\n\n`));
      }, 25_000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
