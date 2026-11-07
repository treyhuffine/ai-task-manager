import { reply, type OperationContext } from '@/lib/server/operation';
import { serviceStatus } from '@/lib/service/client';
import { updateRights, visibleServiceStatus } from '@/lib/service/update-rights';
import { z as rpcZ } from 'zod/v4';

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  const rights = updateRights(request);
  const visible = visibleServiceStatus(await serviceStatus(), rights);
  return reply({ ...(visible ?? { phase: 'unmanaged', update: undefined, version: undefined }), canManage: rights.manage, canUseUpdates: rights.use }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GETInput = rpcZ.object({}).strict().default({});
