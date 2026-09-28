import type { NextRequest } from 'next/server';
import { openSessionFeed } from '@/lib/realtime/session-feed';

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
 * Per-session realtime stream. The app's own pages use the page stream
 * (`/api/stream`), which carries this same feed for each chat on screen
 * over one connection (P3 review); this route stays for other clients.
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
      unsubscribe = openSessionFeed(sessionId, lastEventId, (event, data, id) => enqueue(sse(event, data, id)));
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
