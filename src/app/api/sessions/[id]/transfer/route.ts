/**
 * Continue here (docs/homes-spec.md §8.2, P4.2): the execution's latest move
 * between computers, and starting one. The destination is the home, from any
 * screen, or the caller's own computer: a browser or CLI whose key is linked
 * to it. Work never moves to a computer nobody there asked for.
 */

import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getComputerForApiKey, getHome, latestTransfer } from '@/lib/db/queries';
import { getRequestKey } from '@/lib/auth/request-key';
import { actorFromRequest } from '@/lib/auth/actor';
import { startTransfer, TransferError, viewOf } from '@/lib/transfer/continue';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getChatSessionWithExecution(id);
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
  const transfer = session.executionId ? latestTransfer(session.executionId) : null;
  return Response.json({ transfer: transfer ? viewOf(transfer) : null });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { toComputerId?: unknown; includeUntracked?: unknown } | null;
  if (!body || typeof body.toComputerId !== 'string') {
    return Response.json({ error: 'invalid_params', message: 'Body must include toComputerId.' }, { status: 400 });
  }
  const includeUntracked = Array.isArray(body.includeUntracked) ? body.includeUntracked.filter((f): f is string => typeof f === 'string') : [];
  const key = getRequestKey(request.headers);
  const host = getHome()?.hostComputerId ?? null;
  if (body.toComputerId !== host) {
    const own = key && key.scope !== 'session' ? getComputerForApiKey(key.apiKeyId) : null;
    if (!own || own.id !== body.toComputerId) {
      return Response.json(
        { error: 'not_here', message: 'Work moves to the home, or to the computer you are on. Continue here from a browser or the CLI on that computer.' },
        { status: 403 },
      );
    }
  }
  try {
    const transfer = startTransfer({
      chatSessionId: id,
      toComputerId: body.toComputerId,
      includeUntracked,
      requestedByApiKeyId: key?.apiKeyId ?? null,
      actor: actorFromRequest(request.headers),
    });
    return Response.json({ transfer: viewOf(transfer) }, { status: 202 });
  } catch (err) {
    if (err instanceof TransferError) return Response.json({ error: err.code, message: err.message }, { status: err.status });
    throw err;
  }
}
