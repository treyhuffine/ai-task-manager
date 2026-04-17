import type { NextRequest } from 'next/server';
import { revokeApiKey, updateApiKey } from '@/lib/db/queries';
import type { DeviceType, UpdateApiKeyInput } from '@/db/types';

const ALLOWED_DEVICE_TYPES: readonly DeviceType[] = [
  'host',
  'desktop',
  'laptop',
  'phone',
  'tablet',
  'cli',
  'other',
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      description?: string | null;
      device_type?: DeviceType;
    };

    const patch: UpdateApiKeyInput = {};
    if (body.name !== undefined) {
      const trimmed = body.name.trim();
      if (!trimmed) {
        return Response.json({ error: 'name cannot be empty' }, { status: 400 });
      }
      patch.name = trimmed;
    }
    if (body.description !== undefined) {
      patch.description = body.description;
    }
    if (body.device_type !== undefined) {
      if (!ALLOWED_DEVICE_TYPES.includes(body.device_type)) {
        return Response.json({ error: 'invalid device_type' }, { status: 400 });
      }
      patch.device_type = body.device_type;
    }

    if (Object.keys(patch).length === 0) {
      return Response.json({ error: 'no fields to update' }, { status: 400 });
    }

    const row = updateApiKey(id, patch);
    if (!row) {
      return Response.json({ error: 'Device not found' }, { status: 404 });
    }
    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/devices/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const reason = request.nextUrl.searchParams.get('reason') ?? undefined;
    const row = revokeApiKey(id, reason);
    if (!row) {
      return Response.json({ error: 'Device not found' }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[DELETE /api/devices/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
