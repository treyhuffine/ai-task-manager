import type { NextRequest } from 'next/server';
import { revokeApiKey } from '@/lib/db/queries';

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
