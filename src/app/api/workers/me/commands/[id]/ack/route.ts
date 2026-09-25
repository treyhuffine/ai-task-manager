/**
 * A worker's acknowledgement of a command (docs/homes-build.md, P2 protocol
 * and P2.3): delivered, failed, stale or uncertain. Sent only after the
 * worker journaled the command's outcome, and resent until the home confirms
 * it, so this is idempotent and answers with the state the home holds.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ackWorkerCommand } from '@/lib/db/queries';
import { requireWorker } from '@/lib/workers/route-auth';

const body = z.object({
  state: z.enum(['delivered', 'failed', 'stale', 'uncertain']),
  result: z.unknown().optional(),
  error: z.string().max(4000).nullable().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  const { id } = await params;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const command = ackWorkerCommand(worker.computer.id, id, parsed.data);
  if (!command) return Response.json({ error: 'not_found', message: 'This computer has no such command.' }, { status: 404 });
  return Response.json({ state: command.state });
}
