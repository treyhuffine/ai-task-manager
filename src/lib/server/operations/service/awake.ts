import { legacySchema } from '@/lib/server/inputs';
import { boundedInput, reply, type OperationContext } from '@/lib/server/operation';
import { AwakePreferencesSchema, AwakeStatusSchema } from '@/lib/service/awake-settings';
import { serviceRequest } from '@/lib/service/client';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { z as rpcZ } from 'zod/v4';

const denied = () => reply({ error: 'Only the installation owner can manage host availability.' }, { status: 403 });
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  if (!isInstallationOwner(request)) return denied();
  try { return reply(rpcZ.object({ awake: legacySchema(AwakeStatusSchema) }).parse(await serviceRequest('/awake')), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return reply({ error: 'Host availability controls require a running managed service.' }, { status: 503 }); }
}
export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, request: OperationContext) {
  if (!isInstallationOwner(request)) return denied();
  try {
    const policy = AwakePreferencesSchema.parse(boundedInput(rpcInput.body, 1024));
    return reply(rpcZ.object({ awake: legacySchema(AwakeStatusSchema) }).parse(await serviceRequest('/awake', 'PATCH', 10_000, policy)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Host availability could not be saved.' }, { status: 400 });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
export const PATCHInput = rpcZ.object({ body: legacySchema(AwakePreferencesSchema) }).strict();
