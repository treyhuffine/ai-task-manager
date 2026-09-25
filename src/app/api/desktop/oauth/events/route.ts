import { desktopEnabled, desktopOAuth } from '@/lib/connectors/desktop-oauth';

export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  if (!desktopEnabled()) return new Response('Not found', { status: 404 });
  const encoder = new TextEncoder();
  const after = Number(new URL(request.url).searchParams.get('after') ?? 0);
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      const unsubscribe = desktopOAuth().subscribe(Number.isFinite(after) ? after : 0, (result) => send(`data: ${JSON.stringify(result)}\n\n`));
      const heartbeat = setInterval(() => send(': ping\n\n'), 20_000);
      heartbeat.unref();
      cleanup = () => { unsubscribe(); clearInterval(heartbeat); request.signal.removeEventListener('abort', onAbort); };
      const onAbort = () => { cleanup(); try { controller.close(); } catch {} };
      request.signal.addEventListener('abort', onAbort, { once: true });
      send(': connected\n\n');
      if (request.signal.aborted) onAbort();
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}
