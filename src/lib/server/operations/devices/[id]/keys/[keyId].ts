import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Revoke one of a device's keys. Its worker key turns off running agents
 * there, and its work is settled (`retireWorker`, P2.8). The home's own key
 * is Ri's, on the home's device, and stays.
 */

import { isHostKeyHash } from '@/lib/auth/host-key';
import { getApiKey, getDevice, revokeApiKey } from '@/lib/db/queries';
import { publishDeviceUpdated } from '@/lib/realtime/bus';
import { retireWorker } from '@/lib/workers/retire';

export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, _request: OperationContext) {
  const { id, keyId } = rpcInput.params;
  const device = getDevice(id);
  const key = getApiKey(keyId);
  if (!device || !key || key.deviceId !== id || key.revokedAt) {
    return reply({ error: 'not_found', message: 'No such key on that device.' }, { status: 404 });
  }
  if (isHostKeyHash(key.hash)) {
    return reply({ error: 'home_key', message: `Ri uses this key itself on ${device.name}. It stays.` }, { status: 409 });
  }
  const reason = searchParams(rpcInput.query).get('reason') ?? undefined;
  if (key.role === 'worker') retireWorker(keyId, id, reason ?? 'Local execution turned off by the owner');
  else revokeApiKey(keyId, reason);
  publishDeviceUpdated(id);
  return reply(undefined, { status: 204 });
}

export const DELETEInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1), "keyId": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "reason": rpcZ.string().optional() }).strict().optional(), body: rpcZ.object({}).strict().default({}) }).strict();
