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
      device_type?: DeviceType;
      expires_at?: string | null;
    };

    const name = body.name?.trim();
    if (!name) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const device_type: DeviceType =
      body.device_type && ALLOWED_DEVICE_TYPES.includes(body.device_type)
        ? body.device_type
        : deviceTypeFromUserAgent(request.headers.get('user-agent'));

    const input: CreateApiKeyInput = {
      name,
      description: body.description ?? null,
      device_type,
      expires_at: body.expires_at ?? null,
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
