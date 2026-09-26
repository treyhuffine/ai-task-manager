/**
 * A worker's terminal output (docs/homes-build.md, P3.5): what its shells
 * printed since the last batch, and which exited. Relayed to whoever is
 * watching those terminals on this computer, and kept nowhere: the worker's
 * own ring buffer is what a viewer catches up from.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { deliverTerminalOutput } from '@/lib/terminal/remote';
import { readWorkerBody, requireWorker } from '@/lib/workers/route-auth';

const body = z.object({
  chunks: z.array(z.object({ terminalId: z.string().min(1).max(100), data: z.string(), offset: z.number().int().nonnegative() })).max(500),
  exits: z.array(z.object({ terminalId: z.string().min(1).max(100), code: z.number().int().nullable(), signal: z.number().int().nullable() })).max(500),
});

export async function POST(request: NextRequest) {
  const read = await readWorkerBody(request);
  if (read instanceof Response) return read;
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  const parsed = body.safeParse(read.json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  deliverTerminalOutput(worker.computer.id, parsed.data);
  return Response.json({ ok: true });
}
