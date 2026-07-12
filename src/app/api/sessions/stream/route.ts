import {
  globalSessionChannel,
  subscribe,
} from '@/lib/realtime/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Dashboard-wide lifecycle stream. It carries invalidation signals only, not
 * transcript content. This keeps background session completion visible after
 * the user navigates away and the detailed per-session stream unmounts.
 */
export async function GET() {
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: Uint8Array) => {
        try { controller.enqueue(chunk); } catch { /* closed */ }
      };

      unsubscribe = subscribe(globalSessionChannel, (message) => {
        if (message.kind === 'session_updated') {
          enqueue(sse('session_updated', message));
        }
      });

      // Opening or reconnecting means signals may have been missed. The client
      // treats ready as an instruction to fetch an authoritative snapshot.
      enqueue(sse('ready', {}));
      keepAlive = setInterval(() => {
        enqueue(encoder.encode(': ping\n\n'));
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
