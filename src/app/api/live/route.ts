import type { NextRequest } from 'next/server';
import { openPageFeed, type PageSubscription as Subscription } from '@/lib/realtime/page-feed';
import { isTerminalBase } from '@/lib/realtime/terminal-feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const ID = /^[A-Za-z0-9-]{1,64}$/;
/**
 * A chat event's `updatedAt`, as SQLite's `datetime('now')` writes it. It's
 * compared as a string, so any other shape is dropped (the chat then reads
 * its transcript afresh), never let through or refused.
 */
const CHANGED_AT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const MAX_SUBSCRIPTIONS = 32;

function parseSubscription(raw: string | null): Subscription | null {
  if (!raw) return { s: [], t: [] };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const v = value as Partial<Subscription>;
  const s = Array.isArray(v.s) ? v.s : [];
  const t = Array.isArray(v.t) ? v.t : [];
  if (s.length + t.length > MAX_SUBSCRIPTIONS) return null;
  const okCursor = (c: unknown) => c === null || (typeof c === 'string' && ID.test(c));
  const changedAt = (c: unknown) => (typeof c === 'string' && CHANGED_AT.test(c) ? c : null);
  if (!s.every((e) => Array.isArray(e) && typeof e[0] === 'string' && ID.test(e[0]) && okCursor(e[1] ?? null))) return null;
  if (
    !t.every(
      (e) =>
        Array.isArray(e) &&
        typeof e[0] === 'string' &&
        isTerminalBase(e[0]) &&
        typeof e[1] === 'string' &&
        ID.test(e[1]) &&
        (e[2] === null || e[2] === undefined || (typeof e[2] === 'number' && Number.isInteger(e[2]) && e[2] >= 0)),
    )
  ) {
    return null;
  }
  return { s: s.map(([id, after, since]) => [id, after ?? null, changedAt(since)]), t: t.map(([base, id, after]) => [base, id, after ?? null]) };
}

/**
 * One stream per page (P3 review). A browser keeps six HTTP/1.1
 * connections to a host, and each stream holds one for as long as it's
 * open: a page with the dashboard's stream, a chat's, and a stream per
 * terminal tab used them all, and every ordinary request waited. So a page
 * opens this one stream, naming what it's following (`sub`): the dashboard
 * signals always, each chat on screen (`event: session`, the same feed as
 * `/api/sessions/<id>/stream`), and each terminal on screen (`event:
 * terminal`, the same frames as its own stream). Each carries where the
 * page left off, so a reconnect for a new subscription, or after the page
 * was hidden, loses nothing.
 */
export async function GET(request: NextRequest) {
  const subscription = parseSubscription(request.nextUrl.searchParams.get('sub'));
  if (!subscription) return Response.json({ error: 'Bad subscription' }, { status: 400 });

  const aborter = new AbortController();
  const stops: Array<() => void> = [];
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: Uint8Array) => {
        if (aborter.signal.aborted) return;
        try { controller.enqueue(chunk); } catch { /* closed */ }
      };
      enqueue(encoder.encode('retry: 3000\n\n'));

      stops.push(openPageFeed(subscription, (event, data) => enqueue(sse(event, data)), { signal: aborter.signal }));
      keepAlive = setInterval(() => enqueue(encoder.encode(': ping\n\n')), 25_000);
    },
    cancel() {
      aborter.abort();
      for (const stop of stops) stop();
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
