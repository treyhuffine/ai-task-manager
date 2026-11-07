import { legacySchema } from '@/lib/server/inputs';
import { boundedInput, reply, type OperationContext } from '@/lib/server/operation';
import { updateStatusSchema } from '@/lib/server/service-contracts';
import { serviceRequest } from '@/lib/service/client';
import { mayRunUpdateAction, updateRights } from '@/lib/service/update-rights';
import { UpdateActionSchema } from '@/lib/service/update-settings';
import { z as rpcZ } from 'zod/v4';
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const body = UpdateActionSchema.parse(boundedInput(rpcInput.body, 4096));
    if (!mayRunUpdateAction(updateRights(request), body.action)) return reply({ error: 'Manage updates from the owner’s desktop or local CLI.' }, { status: 403 });
    return reply(rpcZ.object({ update: updateStatusSchema }).parse(await serviceRequest('/update', 'POST', 3000, body)));
  } catch (error) { return reply({ error: error instanceof Error ? error.message : 'Update action failed' }, { status: 400 }); }
}

export const POSTInput = rpcZ.object({ body: legacySchema(UpdateActionSchema) }).strict();
