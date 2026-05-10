import type { NextRequest } from 'next/server';
import { subscribe } from '@/lib/terminal/pty-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  // SSE message — `event:` is optional but lets the client target a
  // specific listener. Multi-line data has to use repeated `data:`
  // prefixes; we sidestep that by JSON-encoding once so the payload
  // is always a single line.
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return encoder.encode(payload);
}

/**
 * Server-Sent Events stream of a terminal's stdout.
 *
 * On connect the server replays the recent buffer (so refreshes don't
 * lose context), then streams live chunks. Cookie auth is what makes
 * `EventSource` work here — it can't attach an Authorization header.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const { id, terminalId } = await params;

  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: Uint8Array) => {
        try { controller.enqueue(chunk); } catch { /* closed */ }
      };

      const result = subscribe(id, terminalId, (chunk) => {
        if (chunk.type === 'data') {
          enqueue(sse('data', chunk.data));
        } else {
          enqueue(sse('exit', { code: chunk.code, signal: chunk.signal }));
          try { controller.close(); } catch { /* */ }
        }
      });

      if (!result) {
        enqueue(sse('error', { message: 'Terminal not found' }));
        try { controller.close(); } catch { /* */ }
        return;
      }
      unsubscribe = result.unsubscribe;

      enqueue(sse('ready', { id: terminalId }));
      if (result.replay) enqueue(sse('data', result.replay));
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
