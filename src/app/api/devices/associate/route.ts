/**
 * Link this browser to the computer whose worker opened it
 * (docs/homes-build.md, P2.2, "This Mac"). The browser's own viewing key
 * redeems the association code from its URL. It records identity only: the
 * key can say it's on that computer, and gains no worker authority.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRequestKey } from '@/lib/auth/request-key';
import { GrantError, redeemAssociateGrant } from '@/lib/db/queries';

const body = z.object({ code: z.string().trim().min(1) });

export async function POST(request: NextRequest) {
  const key = getRequestKey(request.headers);
  if (!key || key.scope !== 'viewer') return Response.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  try {
    const computer = redeemAssociateGrant({ secret: parsed.data.code, apiKeyId: key.apiKeyId });
    return Response.json({ computer: { id: computer.id, name: computer.name } });
  } catch (err) {
    if (err instanceof GrantError) {
      const status = err.code === 'expired' || err.code === 'used' ? 410 : 400;
      return Response.json({ error: err.code, message: err.message }, { status });
    }
    throw err;
  }
}
