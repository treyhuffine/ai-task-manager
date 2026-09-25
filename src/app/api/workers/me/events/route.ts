/**
 * A batch of a worker's journaled events (docs/homes-build.md, P2 protocol
 * and P2.3). The home stores them in order, one transaction each, and
 * answers with the highest contiguous position it holds. The worker resends
 * from there: a replay is skipped, and a gap stops the batch.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getAckedEventSeq, setAckedEventSeq } from '@/lib/db/queries';
import { applyWorkerEvents } from '@/lib/executor/apply';
import type { WorkerEvent } from '@/lib/workers/protocol';
import { requireWorker } from '@/lib/workers/route-auth';

const envelope = z
  .object({
    position: z.number().int().positive(),
    eventId: z.string().min(1).max(100),
    generation: z.number().int().nullable(),
    chatSessionId: z.string().min(1).max(100),
    occurredAt: z.string(),
    kind: z.enum(['chat_event', 'signal']),
    chatEvent: z.object({ role: z.string(), source: z.string() }).passthrough().optional(),
    cumulative: z.boolean().optional(),
    signal: z.object({ type: z.string() }).passthrough().optional(),
  })
  .refine((e) => (e.kind === 'chat_event' ? !!e.chatEvent : !!e.signal), 'Each event carries its chat event or signal.');

const body = z.object({
  events: z.array(envelope).max(500),
  /**
   * Positions up to this one are gone from the worker's journal: compacted
   * after an acknowledgement this home no longer has (it was restored from an
   * older backup). The home moves past them instead of waiting forever.
   */
  gone: z.number().int().nonnegative().optional(),
});

export async function POST(request: NextRequest) {
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { gone } = parsed.data;
  if (gone !== undefined && gone > getAckedEventSeq(worker.computer.id)) {
    console.warn(
      `[workers] ${worker.computer.name} no longer has events up to position ${gone}, past what this home stored. ` +
        'They are skipped: the home was probably restored from an older backup.',
    );
    setAckedEventSeq(worker.computer.id, gone);
  }
  const result = applyWorkerEvents(worker.computer.id, parsed.data.events as unknown as WorkerEvent[]);
  return Response.json(result);
}
