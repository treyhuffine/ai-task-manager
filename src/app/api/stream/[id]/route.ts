import type { NextRequest } from 'next/server';
import type { UpdateStreamInput } from '@/db/types';
import { updateStream } from '@/lib/db/queries';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: UpdateStreamInput = await request.json();

    const row = updateStream(id, body);
    if (!row) return Response.json({ error: 'Stream item not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/stream/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
