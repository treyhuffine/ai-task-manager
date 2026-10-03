import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * A new pairing link for a device already here: a phone that lost its
 * sign-in, another browser on the same computer, or a computer that should
 * connect as the device it already is. The key's token comes back once.
 */

import { getRequestKey } from '@/lib/auth/request-key';
import { addDeviceKey, getDevice } from '@/lib/db/queries';
import { listDeviceViews } from '@/lib/devices/views';
import { publishDeviceUpdated } from '@/lib/realtime/bus';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  const device = getDevice(id);
  if (!device || device.status !== 'active') return reply({ error: 'not_found', message: 'No such device.' }, { status: 404 });
  const { key, token } = addDeviceKey(id);
  publishDeviceUpdated(id);
  const views = await listDeviceViews({ callerKeyId: getRequestKey(request.headers)?.apiKeyId ?? null });
  const view = views.find((d) => d.id === id)!;
  return reply({ device: view, key: view.keys.find((k) => k.id === key.id)!, plaintext: token.plaintext }, { status: 201 });
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
