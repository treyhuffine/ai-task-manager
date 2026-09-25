/**
 * A worker's heartbeat, every 20 seconds (docs/homes-build.md, P2.2): what
 * it runs, which harnesses it has, and that it's awake. The home keeps the
 * last report on the computer and when it arrived. Availability is derived
 * from that: asleep only when reported, unavailable when it's stale.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { recordWorkerHeartbeat } from '@/lib/db/queries';
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
});

export async function POST(request: NextRequest) {
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const computer = recordWorkerHeartbeat(worker.computer.id, parsed.data);
  if (!computer) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json({ ok: true, computer: { id: computer.id, name: computer.name } });
}
