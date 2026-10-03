import { legacySchema } from '@/lib/server/inputs';
import { boundedInput, reply, type OperationContext } from '@/lib/server/operation';
import { releasePreferencesSchema } from '@/lib/server/service-contracts';
import { serviceRequest } from '@/lib/service/client';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { UpdatePreferencesSchema } from '@/lib/service/update-settings';
import { z as rpcZ } from 'zod/v4';

export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, request: OperationContext) {
  if (!isInstallationOwner(request)) return reply({ error: 'Manage updates from the installation owner’s desktop or local CLI.' }, { status: 403 });
  try {
    const preferences = UpdatePreferencesSchema.parse(boundedInput(rpcInput.body, 4096));
    return reply(rpcZ.object({ policy: releasePreferencesSchema }).parse(await serviceRequest('/update/policy', 'PATCH', 3000, preferences)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Update preferences could not be saved' }, { status: 400 });
  }
}

export const PATCHInput = rpcZ.object({ body: legacySchema(UpdatePreferencesSchema) }).strict();
