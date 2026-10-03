import { legacySchema } from '@/lib/server/inputs';
import { boundedInput, reply, type OperationContext } from '@/lib/server/operation';
import { EnvironmentInput, environmentStatus, saveEnvironment } from '@/lib/service/environment';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { z as rpcZ } from 'zod/v4';
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  if (!isInstallationOwner(request)) return reply({ error: 'Installation owner access required' }, { status: 403 });
  return reply(environmentStatus());
}
export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, request: OperationContext) {
  if (!isInstallationOwner(request)) return reply({ error: 'Installation owner access required' }, { status: 403 });
  try { return reply({ ...saveEnvironment(boundedInput(rpcInput.body, 32 * 1024)), restartRequired: true }); }
  catch (error) { return reply({ error: error instanceof Error ? error.message : 'Configuration could not be saved' }, { status: 400 }); }
}

export const GETInput = rpcZ.object({}).strict().default({});
export const PATCHInput = rpcZ.object({ body: legacySchema(EnvironmentInput) }).strict();
