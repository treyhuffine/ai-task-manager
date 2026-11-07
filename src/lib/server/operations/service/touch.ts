import { reply, type OperationContext } from '@/lib/server/operation';
import { noteUse } from '@/lib/service/last-use';
import { z as rpcZ } from 'zod/v4';

/** A window saying a person just typed or clicked, so a Home doesn't update under
 * them (docs/always-on-spec.md 7.2). Polling alone never counts as use. */
export async function POST(_rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  noteUse();
  return reply({});
}

export const POSTInput = rpcZ.object({}).strict().default({});
