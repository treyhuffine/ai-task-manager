/**
 * Revoke one of a device's keys. Its worker key turns off running agents
 * there, and its work is settled (`retireWorker`, P2.8). The home's own key
 * is Ri's, on the home's device, and stays.
 */

import type { NextRequest } from 'next/server';
import { isHostKeyHash } from '@/lib/auth/host-key';
import { getApiKey, getDevice, revokeApiKey } from '@/lib/db/queries';
import { publishDeviceUpdated } from '@/lib/realtime/bus';
import { retireWorker } from '@/lib/workers/retire';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; keyId: string }> }) {
  const { id, keyId } = await params;
  const device = getDevice(id);
  const key = getApiKey(keyId);
  if (!device || !key || key.deviceId !== id || key.revokedAt) {
    return Response.json({ error: 'not_found', message: 'No such key on that device.' }, { status: 404 });
  }
  if (isHostKeyHash(key.hash)) {
    return Response.json({ error: 'home_key', message: `Ri uses this key itself on ${device.name}. It stays.` }, { status: 409 });
  }
  const reason = request.nextUrl.searchParams.get('reason') ?? undefined;
  if (key.role === 'worker') retireWorker(keyId, id, reason ?? 'Local execution turned off by the owner');
  else revokeApiKey(keyId, reason);
  publishDeviceUpdated(id);
  return new Response(null, { status: 204 });
}
