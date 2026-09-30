/**
 * One device: PATCH renames it or says what it is, DELETE removes it. Removing
 * one stops every key it has, and its worker's work is settled
 * (`retireWorker`, P2.8). The device the home runs on can't be removed.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRequestKey } from '@/lib/auth/request-key';
import { getDevice, getHome, getWorkerKeyId, removeDevice, updateDevice } from '@/lib/db/queries';
import { DEVICE_KINDS } from '@/lib/db/schema';
import { listDeviceViews } from '@/lib/devices/views';
import { publishDeviceUpdated } from '@/lib/realtime/bus';
import { retireWorker } from '@/lib/workers/retire';

type Params = { params: Promise<{ id: string }> };

const patchBody = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty.').max(80).optional(),
    kind: z.enum(DEVICE_KINDS).optional(),
  })
  .refine((b) => b.name !== undefined || b.kind !== undefined, 'Nothing to change.');

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const parsed = patchBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const current = getDevice(id);
  if (!current || current.status !== 'active') return Response.json({ error: 'not_found', message: 'No such device.' }, { status: 404 });
  updateDevice(id, parsed.data);
  publishDeviceUpdated(id);
  const views = await listDeviceViews({ callerKeyId: getRequestKey(request.headers)?.apiKeyId ?? null });
  return Response.json(views.find((d) => d.id === id));
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const device = getDevice(id);
  if (!device || device.status !== 'active') return Response.json({ error: 'not_found', message: 'No such device.' }, { status: 404 });
  if (getHome()?.hostDeviceId === id) {
    return Response.json({ error: 'home_device', message: `${device.name} is where this home runs. It can't be removed.` }, { status: 409 });
  }
  const reason = request.nextUrl.searchParams.get('reason') ?? `${device.name} was removed by the owner`;
  // Its worker first, so its work is settled and its stream closes now.
  const workerKeyId = getWorkerKeyId(id);
  if (workerKeyId) retireWorker(workerKeyId, id, reason);
  removeDevice(id, reason);
  publishDeviceUpdated(id);
  return new Response(null, { status: 204 });
}
