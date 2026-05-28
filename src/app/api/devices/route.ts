import type { NextRequest } from 'next/server';
import { createApiKey, listApiKeys } from '@/lib/db/queries';
import { deviceTypeFromUserAgent } from '@/lib/auth/device-type';
import type { CreateApiKeyInput, DeviceType } from '@/db/types';

const ALLOWED_DEVICE_TYPES: readonly DeviceType[] = [
  'host',
  'computer',
  'phone',
  'tablet',
  'service',
  'other',
];

export async function GET(request: NextRequest) {
  try {
    const includeRevoked = request.nextUrl.searchParams.get('include_revoked') === '1';
    const rows = listApiKeys({ includeRevoked });
    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/devices]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      name?: string;
      description?: string | null;
      deviceType?: DeviceType;
      expiresAt?: string | null;
    };

    const name = body.name?.trim();
    if (!name) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const deviceType: DeviceType =
      body.deviceType && ALLOWED_DEVICE_TYPES.includes(body.deviceType)
        ? body.deviceType
        : deviceTypeFromUserAgent(request.headers.get('user-agent'));

    const input: CreateApiKeyInput = {
      name,
      description: body.description ?? null,
      deviceType,
      expiresAt: body.expiresAt ?? null,
    };

    const { key, token } = createApiKey(input);
    // Client builds pairing URLs from `plaintext` + window.location /
    // server-known base URLs — no need to return a pre-baked one here.
    return Response.json(
      {
        key,
        plaintext: token.plaintext,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[POST /api/devices]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
