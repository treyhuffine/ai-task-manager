/**
 * Issue a worker enroll grant (docs/homes-build.md, P2.2). An owner asks,
 * with any viewing key: the home's own CLI, a browser, or the device to be
 * enrolled asking for itself. The code is shown once and works once, within
 * 10 minutes. Redeeming it at `/api/workers/enroll` makes the device a
 * worker with a new key; this key gains nothing.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRequestKey } from '@/lib/auth/request-key';
import { createDeviceGrant, getDevice, getDeviceForApiKey, GrantError } from '@/lib/db/queries';

const body = z.object({
  /** The device to enroll. Omitted: the calling key's own device, or a new one when `deviceName` is given. */
  deviceId: z.string().min(1).optional(),
  /** A name for a new device. */
  deviceName: z.string().trim().min(1).max(80).optional(),
});

export async function POST(request: NextRequest) {
  const key = getRequestKey(request.headers);
  if (!key || key.scope !== 'viewer') {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { deviceName } = parsed.data;
  const deviceId = parsed.data.deviceId ?? (deviceName ? null : getDeviceForApiKey(key.apiKeyId)?.id ?? null);
  if (!deviceId && !deviceName) {
    return Response.json(
      { error: 'invalid_params', message: 'Name the device to enroll, or ask from that device.' },
      { status: 400 },
    );
  }
  try {
    const { grant, secret } = createDeviceGrant({
      kind: 'enroll',
      deviceId,
      deviceName: deviceName ?? null,
      createdByApiKeyId: key.apiKeyId,
    });
    const device = deviceId ? getDevice(deviceId) : null;
    return Response.json(
      {
        code: secret,
        expiresAt: grant.expiresAt,
        device: device ? { id: device.id, name: device.name } : null,
        deviceName: device?.name ?? deviceName ?? null,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof GrantError) return Response.json({ error: err.code, message: err.message }, { status: 400 });
    throw err;
  }
}
