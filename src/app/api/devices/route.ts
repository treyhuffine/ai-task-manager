/**
 * This home's devices (docs/homes-spec.md §5.1): GET lists each device once,
 * with whether it runs agents and the keys it signs in with. POST pairs a
 * new one: the device and its first key, whose token comes back once.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRequestKey } from '@/lib/auth/request-key';
import { deviceKindFromUserAgent } from '@/lib/auth/device-kind';
import { pairDevice } from '@/lib/db/queries';
import { DEVICE_KINDS } from '@/lib/db/schema';
import { listDeviceViews } from '@/lib/devices/views';
import { withCompression } from '@/lib/api/compression';
import { publishDeviceUpdated } from '@/lib/realtime/bus';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  const includeRevoked = request.nextUrl.searchParams.get('includeRevoked') === '1';
  const callerKeyId = getRequestKey(request.headers)?.apiKeyId ?? null;
  return Response.json(await listDeviceViews({ includeRevoked, callerKeyId }));
}

const pairBody = z.object({
  name: z.string().trim().min(1, 'Name the device.').max(80),
  kind: z.enum(DEVICE_KINDS).optional(),
  description: z.string().max(500).nullish(),
  expiresAt: z.string().datetime().nullish(),
});

export async function POST(request: NextRequest) {
  const parsed = pairBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { device, key, token } = pairDevice({
    name: parsed.data.name,
    kind: parsed.data.kind ?? deviceKindFromUserAgent(request.headers.get('user-agent')),
    description: parsed.data.description ?? null,
    expiresAt: parsed.data.expiresAt ?? null,
  });
  publishDeviceUpdated(device.id);
  const views = await listDeviceViews({ callerKeyId: getRequestKey(request.headers)?.apiKeyId ?? null });
  const view = views.find((d) => d.id === device.id)!;
  // The client builds pairing URLs from `plaintext` and the base URLs it
  // knows: no need to return one here.
  return Response.json({ device: view, key: view.keys.find((k) => k.id === key.id)!, plaintext: token.plaintext }, { status: 201 });
}
