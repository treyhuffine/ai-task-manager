import { legacySchema } from '@/lib/server/inputs';
import { boundedInput, reply, type OperationContext } from '@/lib/server/operation';
import { updateStatusSchema } from '@/lib/server/service-contracts';
import { serviceRequest } from '@/lib/service/client';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { UpdateActionSchema } from '@/lib/service/update-settings';
import { z as rpcZ } from 'zod/v4';
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  if (!isInstallationOwner(request)) return reply({ error: 'Manage updates from the installation owner’s desktop or local CLI.' }, { status: 403 });
  try {
    const body = UpdateActionSchema.parse(boundedInput(rpcInput.body, 4096));
    return reply(rpcZ.object({ update: updateStatusSchema }).parse(await serviceRequest('/update', 'POST', 3000, body)));
  } catch (error) { return reply({ error: error instanceof Error ? error.message : 'Update action failed' }, { status: 400 }); }
}

export const POSTInput = rpcZ.object({ body: legacySchema(UpdateActionSchema) }).strict();
