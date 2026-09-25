/**
 * A worker's heartbeat, every 20 seconds (docs/homes-build.md, P2.2 and
 * P2.4): what it runs, which harnesses it has, and that it's awake. The home
 * keeps the last report on the computer and when it arrived. Availability is
 * derived from that: asleep only when reported, unavailable when it's stale.
 *
 * It also carries what's live there, which replaces the home's mirror for
 * that computer, and the placements it holds. The home answers with any it
 * no longer holds (the execution moved, or the placement ended), and the
 * worker stops their sessions before anything else.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getOpenPlacement, recordWorkerHeartbeat } from '@/lib/db/queries';
import { replaceComputerMirror, type WorkerLiveSnapshot } from '@/lib/executor/remote-live';
import type { WorkerHeartbeatReply } from '@/lib/workers/protocol';
import { requireWorker } from '@/lib/workers/route-auth';

const harness = z
  .object({
    harness: z.string(),
    binary: z.object({ status: z.string() }).passthrough(),
    capabilities: z.record(z.string(), z.object({ supported: z.boolean() }).passthrough()),
  })
  .passthrough();

const body = z.object({
  protocol: z.number().int(),
  version: z.string().max(80),
  harnesses: z.array(harness).max(20),
  state: z.enum(['awake', 'asleep', 'stopped']),
  live: z
    .object({
      running: z.array(z.string()).max(1000),
      pending: z.array(z.object({ requestId: z.string(), sessionId: z.string() }).passthrough()).max(1000),
      backgroundTasks: z.record(z.string(), z.array(z.string())),
    })
    .optional(),
  placements: z
    .array(z.object({ executionId: z.string(), generation: z.number().int(), chatSessionIds: z.array(z.string()) }))
    .max(1000)
    .optional(),
});

export async function POST(request: NextRequest) {
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { live, placements, ...report } = parsed.data;
  const computer = recordWorkerHeartbeat(worker.computer.id, report);
  if (!computer) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (live) replaceComputerMirror(computer.id, live as unknown as WorkerLiveSnapshot);
  const release: WorkerHeartbeatReply['release'] = [];
  for (const held of placements ?? []) {
    const open = getOpenPlacement(held.executionId);
    if (!open || open.computerId !== computer.id || open.generation !== held.generation) {
      release.push({ executionId: held.executionId, chatSessionIds: held.chatSessionIds });
    }
  }
  const reply: WorkerHeartbeatReply & { computer: { id: string; name: string } } = {
    ok: true,
    release,
    computer: { id: computer.id, name: computer.name },
  };
  return Response.json(reply);
}
