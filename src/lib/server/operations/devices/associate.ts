import { legacySchema } from '@/lib/server/inputs';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Link this browser to the device whose worker opened it
 * (docs/homes-build.md, P2.2, "This Mac"). The browser's own viewing key
 * redeems the association code from its URL. It records identity only: the
 * key can say it's on that device, and gains no worker authority.
 */

import { getRequestKey } from '@/lib/auth/request-key';
import { GrantError, redeemAssociateGrant } from '@/lib/db/queries';
import { z } from 'zod';

const body = z.object({ code: z.string().trim().min(1) });

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const key = getRequestKey(request.headers);
  if (!key || key.scope !== 'viewer') return reply({ error: 'unauthorized' }, { status: 401 });
  const parsed = body.safeParse(rpcInput.body);
  if (!parsed.success) {
    return reply({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  try {
    const device = redeemAssociateGrant({ secret: parsed.data.code, apiKeyId: key.apiKeyId });
    return reply({ device: { id: device.id, name: device.name } });
  } catch (err) {
    if (err instanceof GrantError) {
      const status = err.code === 'expired' || err.code === 'used' ? 410 : 400;
      return reply({ error: err.code, message: err.message }, { status });
    }
    throw err;
  }
}

export const POSTInput = rpcZ.object({ body: legacySchema(body) }).strict();
