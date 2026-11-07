import { reply, type OperationContext } from '@/lib/server/operation';
import { serviceRequest } from '@/lib/service/client';
import { updateRights } from '@/lib/service/update-rights';
import type { RollbackStatus } from '@/lib/service/update';
import { z as rpcZ } from 'zod/v4';

/** What going back one release would lose, shown before anyone confirms it (7.6). */
export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  if (!updateRights(request).manage) return reply({ error: 'Roll back from this computer.' }, { status: 403 });
  return reply(await serviceRequest<{ rollback: RollbackStatus }>('/update/rollback', 'GET', 15_000), { headers: { 'Cache-Control': 'no-store' } });
}

export const GETInput = rpcZ.object({}).strict().default({});
