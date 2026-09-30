/**
 * A new pairing link for a device already here: a phone that lost its
 * sign-in, another browser on the same computer, or a computer that should
 * connect as the device it already is. The key's token comes back once.
 */

import type { NextRequest } from 'next/server';
import { getRequestKey } from '@/lib/auth/request-key';
import { addDeviceKey, getDevice } from '@/lib/db/queries';
import { listDeviceViews } from '@/lib/devices/views';
import { publishDeviceUpdated } from '@/lib/realtime/bus';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const device = getDevice(id);
  if (!device || device.status !== 'active') return Response.json({ error: 'not_found', message: 'No such device.' }, { status: 404 });
  const { key, token } = addDeviceKey(id);
  publishDeviceUpdated(id);
  const views = await listDeviceViews({ callerKeyId: getRequestKey(request.headers)?.apiKeyId ?? null });
  const view = views.find((d) => d.id === id)!;
  return Response.json({ device: view, key: view.keys.find((k) => k.id === key.id)!, plaintext: token.plaintext }, { status: 201 });
}
