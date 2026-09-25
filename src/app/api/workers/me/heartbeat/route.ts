/**
 * A worker's heartbeat, every 20 seconds (docs/homes-build.md, P2.2 and
 * P2.4): what it runs, which harnesses it has, and that it's awake. The home
 * keeps the last report on the computer and when it arrived. Availability is
 * derived from that: asleep only when reported, unavailable when it's stale.
 *
 * It also carries what's live there, which replaces the home's mirror for
 * that computer, and the placements it holds. The home answers with any it
 * no longer holds (the execution moved, or the placement ended), and the
 * worker fences them and stops their sessions before anything else.
 *
 * Only chats this computer runs, at the generation it runs them, reach the
 * mirror: a worker can't show another computer's chat as running or give it
 * prompts, and a late heartbeat from before a move can't bring back the old
 * placement's state (P2 review fixes).
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { chatPlacement, getOpenPlacement, recordWorkerHeartbeat } from '@/lib/db/queries';
import { clearComputerMirror, replaceComputerMirror, type WorkerLiveSnapshot } from '@/lib/executor/remote-live';
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
      generations: z.record(z.string(), z.number().int().nullable()).optional(),
    })
    .optional(),
  placements: z
    .array(z.object({ executionId: z.string(), generation: z.number().int(), chatSessionIds: z.array(z.string()) }))
    .max(1000)
    .optional(),
});

/** The part of a snapshot about chats this computer runs, at the generation it runs them. */
function ownLive(computerId: string, live: z.infer<typeof body>['live'] & object): WorkerLiveSnapshot {
  const owned = new Map<string, boolean>();
  const ours = (chatSessionId: string) => {
    let known = owned.get(chatSessionId);
    if (known === undefined) {
      const placement = chatPlacement(chatSessionId);
      known =
        !!placement &&
        !placement.isHome &&
        placement.computerId === computerId &&
        (placement.executionId === null || live.generations?.[chatSessionId] === placement.generation);
      owned.set(chatSessionId, known);
    }
    return known;
  };
  return {
    running: live.running.filter(ours),
    pending: (live.pending as unknown as WorkerLiveSnapshot['pending']).filter((p) => ours(p.sessionId)),
    backgroundTasks: Object.fromEntries(Object.entries(live.backgroundTasks).filter(([chat]) => ours(chat))),
  };
}

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
  if (live) replaceComputerMirror(computer.id, ownLive(computer.id, live));
  // A worker that's stopping closes its sessions, and their prompts with
  // them. One that just goes quiet keeps its mirror: unknown is not stopped.
  else if (report.state === 'stopped') clearComputerMirror(computer.id);
  const release: WorkerHeartbeatReply['release'] = [];
  for (const held of placements ?? []) {
    const open = getOpenPlacement(held.executionId);
    if (!open || open.computerId !== computer.id || open.generation !== held.generation) {
      release.push({ executionId: held.executionId, generation: held.generation, chatSessionIds: held.chatSessionIds });
    }
  }
  const reply: WorkerHeartbeatReply & { computer: { id: string; name: string } } = {
    ok: true,
    release,
    computer: { id: computer.id, name: computer.name },
  };
  return Response.json(reply);
}
