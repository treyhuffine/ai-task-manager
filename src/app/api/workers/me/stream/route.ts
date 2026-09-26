/**
 * A worker's event stream (docs/homes-build.md, P2.2 and P2.3). The worker
 * opens it with `after`, its durable receipt cursor, and keeps it open. The
 * home sends `hello`, then every command numbered after the cursor, then
 * queued commands as they're numbered, `request`s as it has them, and a
 * `ping` every 15 seconds. Each ping re-checks the key, so a revoked worker
 * gets `revoked` and is cut off within that interval, if the revoke itself
 * didn't already close the stream. A queued command whose chat or execution
 * no longer runs here at its generation is marked stale instead of sent.
 */

import type { NextRequest } from 'next/server';
import { uuidv7 } from 'uuidv7';
import type { WorkerCommandRecord } from '@/db/types';
import { getAckedEventSeq, getHome, getWorkerEnrollment, staleQueuedCommands, takeCommandsForStream } from '@/lib/db/queries';
import { inTransaction } from '@/lib/effects/after-commit';
import { registerConnection } from '@/lib/workers/hub';
import { WORKER_PROTOCOL, WORKER_STREAM_PING_MS, type WorkerCommand, type WorkerStreamEvent } from '@/lib/workers/protocol';
import { requireWorker } from '@/lib/workers/route-auth';
import { settleUndelivered } from '@/lib/workers/undelivered';
import { announceDelivery, announceOpenSends } from '@/lib/workers/delivery';
import { publishComputerUpdated } from '@/lib/realtime/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

function frame(event: WorkerStreamEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function toWire(command: WorkerCommandRecord): WorkerCommand {
  return {
    id: command.id,
    seq: command.seq!,
    kind: command.kind,
    target: { executionId: command.executionId, chatSessionId: command.chatSessionId, generation: command.generation },
    actor: command.actor,
    issuedAt: command.createdAt,
    payload: command.payload,
  };
}

export async function GET(request: NextRequest) {
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  const homeId = getHome()?.id ?? '';
  const after = Math.max(0, Number.parseInt(request.nextUrl.searchParams.get('after') ?? '0', 10) || 0);

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
      // What this stream has sent, starting from what the worker has received.
      let cursor = after;
      const pump = () => {
        if (closed) return;
        // Ownership first: a command for a placement this computer no longer
        // holds is never sent, and a send among them finishes its run (P2.6).
        inTransaction((after) => {
          for (const command of staleQueuedCommands(worker.computer.id)) settleUndelivered(command, after);
        });
        for (const command of takeCommandsForStream(worker.computer.id, cursor)) {
          send({ type: 'command', command: toWire(command) });
          cursor = Math.max(cursor, command.seq ?? cursor);
          // A message on its way to this computer (P3.2).
          announceDelivery(command);
        }
      };
      const unregister = registerConnection({
        id: uuidv7(),
        computerId: worker.computer.id,
        openedAt: Date.now(),
        send,
        wake: pump,
        close,
      });
      // Every screen showing this computer's work learns it connected (P3.2).
      publishComputerUpdated(worker.computer.id);
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
        // Messages it hasn't confirmed now wait for it, and its work says it
        // dropped (P3.2).
        announceOpenSends(worker.computer.id);
        publishComputerUpdated(worker.computer.id);
      };
      request.signal.addEventListener('abort', close);
      send({
        type: 'hello',
        homeId,
        computerId: worker.computer.id,
        protocol: WORKER_PROTOCOL,
        ackedEventSeq: getAckedEventSeq(worker.computer.id),
      });
      pump();
      // Terminal history imported from this computer catches up (P2.9).
      void import('@/lib/import/remote').then(({ syncRemoteImportsOn }) => syncRemoteImportsOn(worker.computer.id)).catch(() => {});
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
