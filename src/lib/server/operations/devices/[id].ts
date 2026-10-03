import { legacySchema } from '@/lib/server/inputs';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * One device: PATCH renames it or says what it is, DELETE removes it. Removing
 * one stops every key it has, and its worker's work is settled
 * (`retireWorker`, P2.8). The device the home runs on can't be removed.
 */

import { getRequestKey } from '@/lib/auth/request-key';
import { getDevice, getHome, getWorkerKeyId, removeDevice, updateDevice } from '@/lib/db/queries';
import { DEVICE_KINDS } from '@/lib/db/schema';
import { listDeviceViews } from '@/lib/devices/views';
import { publishDeviceUpdated } from '@/lib/realtime/bus';
import { retireWorker } from '@/lib/workers/retire';
import { z } from 'zod';

const patchBody = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty.').max(80).optional(),
    kind: z.enum(DEVICE_KINDS).optional(),
  })
  .refine((b) => b.name !== undefined || b.kind !== undefined, 'Nothing to change.');

export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  const parsed = patchBody.safeParse(rpcInput.body);
  if (!parsed.success) {
    return reply({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const current = getDevice(id);
  if (!current || current.status !== 'active') return reply({ error: 'not_found', message: 'No such device.' }, { status: 404 });
  updateDevice(id, parsed.data);
  publishDeviceUpdated(id);
  const views = await listDeviceViews({ callerKeyId: getRequestKey(request.headers)?.apiKeyId ?? null });
  return reply(views.find((d) => d.id === id));
}

export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const device = getDevice(id);
  if (!device || device.status !== 'active') return reply({ error: 'not_found', message: 'No such device.' }, { status: 404 });
  if (getHome()?.hostDeviceId === id) {
    return reply({ error: 'home_device', message: `${device.name} is where this home runs. It can't be removed.` }, { status: 409 });
  }
  const reason = searchParams(rpcInput.query).get('reason') ?? `${device.name} was removed by the owner`;
  // Its worker first, so its work is settled and its stream closes now.
  const workerKeyId = getWorkerKeyId(id);
  if (workerKeyId) retireWorker(workerKeyId, id, reason);
  removeDevice(id, reason);
  publishDeviceUpdated(id);
  return reply(undefined, { status: 204 });
}

export const PATCHInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: legacySchema(patchBody) }).strict();
export const DELETEInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "reason": rpcZ.string().optional() }).strict().optional(), body: rpcZ.object({}).strict().default({}) }).strict();
