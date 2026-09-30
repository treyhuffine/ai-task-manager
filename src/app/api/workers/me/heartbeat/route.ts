/**
 * A worker's heartbeat, every 20 seconds (docs/homes-build.md, P2.2 and
 * P2.4): what it runs, which harnesses it has, and that it's awake. The home
 * keeps the last report on the device and when it arrived. Availability is
 * derived from that: asleep only when reported, unavailable when it's stale.
 *
 * It also carries what's live there, which replaces the home's mirror for
 * that device, and the placements it holds. The home answers with any it
 * no longer holds (the execution moved, or the placement ended), and the
 * worker fences them and stops their sessions before anything else.
 *
 * Only chats this device runs, at the generation it runs them, reach the
 * mirror: a worker can't show another device's chat as running or give it
 * prompts, and a late heartbeat from before a move can't bring back the old
 * placement's state (P2 review fixes). Nor can one still in flight when the
 * worker is turned off: the enrollment is checked after the last await, in
 * the same tick as the writes (P2.7 to P2.9 review fixes and re-check).
 */

import { recordWorkerCompatibility, WorkerJournalReportSchema } from '@/lib/workers/update-compatibility';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { chatPlacement, getOpenPlacement, recordWorkerHeartbeat, transferReservation } from '@/lib/db/queries';
import { clearDeviceMirror, replaceDeviceMirror, type WorkerLiveSnapshot } from '@/lib/executor/remote-live';
import type { WorkerHeartbeatReply } from '@/lib/workers/protocol';
import { readWorkerBody, requireWorker } from '@/lib/workers/route-auth';
import { publishDeviceUpdated } from '@/lib/realtime/bus';

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
  journal: WorkerJournalReportSchema.optional(),
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

/** The part of a snapshot about chats this device runs, at the generation it runs them. */
function ownLive(deviceId: string, live: z.infer<typeof body>['live'] & object): WorkerLiveSnapshot {
  const owned = new Map<string, boolean>();
  const ours = (chatSessionId: string) => {
    let known = owned.get(chatSessionId);
    if (known === undefined) {
      const placement = chatPlacement(chatSessionId);
      known =
        !!placement &&
        !placement.isHome &&
        placement.deviceId === deviceId &&
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
  const read = await readWorkerBody(request);
  if (read instanceof Response) return read;
  // After the last await, and nothing awaits from here to the writes.
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  const parsed = body.safeParse(read.json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { live, placements, journal, ...report } = parsed.data;
  if (report.protocol !== worker.agreement.protocol) return Response.json({ error: 'worker_protocol', message: 'Heartbeat differs from the authenticated negotiated protocol.' }, { status: 426 });
  const device = recordWorkerHeartbeat(worker.device.id, report);
  if (!device) return Response.json({ error: 'unauthorized' }, { status: 401 });
  recordWorkerCompatibility(device.id, worker.apiKeyId, worker.peer, journal, report.state === 'stopped', report.protocol);
  // Awake, asleep or stopping: what its work says about it changes (P3.2).
  if (worker.device.reportedState !== report.state) publishDeviceUpdated(device.id);
  if (live) replaceDeviceMirror(device.id, ownLive(device.id, live), journal?.lastEvent);
  // A worker that's stopping closes its sessions, and their prompts with
  // them. One that just goes quiet keeps its mirror: unknown is not stopped.
  else if (report.state === 'stopped') clearDeviceMirror(device.id);
  const release: WorkerHeartbeatReply['release'] = [];
  for (const held of placements ?? []) {
    // A transfer preparing the work here holds its next generation for it (P4.2).
    const reserved = transferReservation(held.executionId);
    if (reserved?.deviceId === device.id && reserved.generation === held.generation) continue;
    const open = getOpenPlacement(held.executionId);
    if (!open || open.deviceId !== device.id || open.generation !== held.generation) {
      release.push({ executionId: held.executionId, generation: held.generation, chatSessionIds: held.chatSessionIds });
    }
  }
  const reply: WorkerHeartbeatReply & { device: { id: string; name: string } } = {
    ok: true,
    release,
    device: { id: device.id, name: device.name },
  };
  return Response.json(reply);
}
