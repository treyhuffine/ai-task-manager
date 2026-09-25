/**
 * A worker's event stream (docs/homes-build.md, P2.2). The worker opens it
 * and keeps it open; the home sends `hello`, then `request`s as it has them,
 * and a `ping` every 15 seconds. Each ping re-checks the key, so a revoked
 * worker gets `revoked` and is cut off within that interval, if the revoke
 * itself didn't already close the stream.
 */

import type { NextRequest } from 'next/server';
import { uuidv7 } from 'uuidv7';
import { getHome, getWorkerEnrollment } from '@/lib/db/queries';
import { registerConnection } from '@/lib/workers/hub';
import { WORKER_PROTOCOL, WORKER_STREAM_PING_MS, type WorkerStreamEvent } from '@/lib/workers/protocol';
import { requireWorker } from '@/lib/workers/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

function frame(event: WorkerStreamEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function GET(request: NextRequest) {
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  const homeId = getHome()?.id ?? '';

  let cleanup: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (event: WorkerStreamEvent) => {
        if (closed) return;
        controller.enqueue(frame(event));
      };
      const unregister = registerConnection({
        id: uuidv7(),
        computerId: worker.computer.id,
        openedAt: Date.now(),
        send,
        close,
      });
      const ping = setInterval(() => {
        if (!getWorkerEnrollment(worker.apiKeyId)) {
          send({ type: 'revoked', message: `Local execution on ${worker.computer.name} was turned off.` });
          close();
          return;
        }
        send({ type: 'ping' });
      }, WORKER_STREAM_PING_MS);
      cleanup = () => {
        clearInterval(ping);
        unregister();
      };
      request.signal.addEventListener('abort', close);
      send({ type: 'hello', homeId, computerId: worker.computer.id, protocol: WORKER_PROTOCOL });
    },
    cancel() {
      cleanup?.();
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
