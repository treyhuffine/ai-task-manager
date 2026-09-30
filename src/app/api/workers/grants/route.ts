/**
 * Issue a worker enroll grant (docs/homes-build.md, P2.2). An owner asks,
 * with any viewing key: the home's own CLI, a browser, or the computer to be
 * enrolled asking for itself. The code is shown once and works once, within
 * 10 minutes. Redeeming it at `/api/workers/enroll` makes the computer a
 * worker with a new key; this key gains nothing.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRequestKey } from '@/lib/auth/request-key';
import { createComputerGrant, getComputer, getComputerForApiKey, GrantError } from '@/lib/db/queries';

const body = z.object({
  /** The computer to enroll. Omitted: the calling key's own computer, or a new one when `computerName` is given. */
  computerId: z.string().min(1).optional(),
  /** A name for a new computer. */
  computerName: z.string().trim().min(1).max(80).optional(),
});

export async function POST(request: NextRequest) {
  const key = getRequestKey(request.headers);
  if (!key || key.scope !== 'viewer') {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { computerName } = parsed.data;
  const computerId = parsed.data.computerId ?? (computerName ? null : getComputerForApiKey(key.apiKeyId)?.id ?? null);
  if (!computerId && !computerName) {
    return Response.json(
      { error: 'invalid_params', message: 'Name the computer to enroll, or ask from that computer.' },
      { status: 400 },
    );
  }
  try {
    const { grant, secret } = createComputerGrant({
      kind: 'enroll',
      computerId,
      computerName: computerName ?? null,
      createdByApiKeyId: key.apiKeyId,
    });
    const computer = computerId ? getComputer(computerId) : null;
    return Response.json(
      {
        code: secret,
        expiresAt: grant.expiresAt,
        computer: computer ? { id: computer.id, name: computer.name } : null,
        computerName: computer?.name ?? computerName ?? null,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof GrantError) return Response.json({ error: err.code, message: err.message }, { status: 400 });
    throw err;
  }
}
