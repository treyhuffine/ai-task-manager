import type { NextRequest } from 'next/server';
import { subscribe } from '@/lib/terminal/pty-manager';
import { terminalOwnerForSession } from '@/lib/terminal/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

function sse(event: string, data: unknown, id?: number): Uint8Array {
  // SSE message — `event:` is optional but lets the client target a
  // specific listener. Multi-line data has to use repeated `data:`
  // prefixes; we sidestep that by JSON-encoding once so the payload
  // is always a single line.
  //
  // `id:` is what makes reconnects resumable. The browser stores the last
  // one it saw and replays it as `Last-Event-ID` on the next connect,
  // with no client-side bookkeeping needed.
  const idLine = id === undefined ? '' : `id: ${id}\n`;
  const payload = `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return encoder.encode(payload);
}

/** Resume cursor from a reconnecting `EventSource`, if it sent one. */
function parseLastEventId(request: NextRequest): number | undefined {
  const raw = request.headers.get('last-event-id');
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Server-Sent Events stream of a terminal's stdout.
 *
 * On connect the server replays the recent buffer (so refreshes don't
 * lose context), then streams live chunks. Cookie auth is what makes
 * `EventSource` work here — it can't attach an Authorization header.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const { id, terminalId } = await params;
  const since = parseLastEventId(request);

  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: Uint8Array) => {
        try { controller.enqueue(chunk); } catch { /* closed */ }
      };

      const ownerId = terminalOwnerForSession(id);
      if (!ownerId) {
        enqueue(sse('error', { message: 'Session not found' }));
        try { controller.close(); } catch { /* */ }
        return;
      }

      const result = subscribe(ownerId, terminalId, (chunk) => {
        if (chunk.type === 'data') {
          enqueue(sse('data', chunk.data, chunk.offset));
        } else {
          enqueue(sse('exit', { code: chunk.code, signal: chunk.signal }));
          try { controller.close(); } catch { /* */ }
        }
      }, since);

      if (!result) {
        enqueue(sse('error', { message: 'Terminal not found' }));
        try { controller.close(); } catch { /* */ }
        return;
      }
      unsubscribe = result.unsubscribe;

      // `resumed` tells the client this is a continuation, not a fresh
      // view, so it doesn't clear a screen it's about to be handed the
      // tail of. `gap` is the exception: output was evicted while we were
      // away, so the replay can't be spliced on cleanly.
      enqueue(sse('ready', { id: terminalId, resumed: since !== undefined && !result.gap }));
      if (result.replay) enqueue(sse('data', result.replay, result.offset));
      if (result.exited) {
        enqueue(sse('exit', { code: result.exitCode, signal: null }));
        try { controller.close(); } catch { /* */ }
        return;
      }

      // Idle keep-alive: comment lines are ignored by EventSource but keep
      // proxies/load-balancers from severing an "idle" connection. 25s
      // because most timeouts kick in around 30–60s.
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
