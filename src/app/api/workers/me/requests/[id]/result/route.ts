/**
 * A worker's answer to a request the home sent down its stream
 * (docs/homes-build.md, P2.2). Only the computer that was asked can answer,
 * and only while the home is still waiting.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { settleRequest } from '@/lib/workers/hub';
import { readWorkerBody, requireWorker } from '@/lib/workers/route-auth';

const body = z.union([
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string().max(2000), unsupported: z.boolean().optional() }),
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const read = await readWorkerBody(request);
  if (read instanceof Response) return read;
  // After the last await, and nothing awaits from here to the writes.
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  const parsed = body.safeParse(read.json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const result = parsed.data.ok ? { ok: true as const, value: parsed.data.value ?? null } : parsed.data;
  const settled = settleRequest(worker.computer.id, id, result);
  if (!settled) return Response.json({ error: 'gone', message: 'Nothing is waiting for that answer.' }, { status: 410 });
  return Response.json({ ok: true });
}
