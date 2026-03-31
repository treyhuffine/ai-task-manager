import type { NextRequest } from 'next/server';
import { getArea, updateArea } from '@/lib/db/queries';
import type { UpdateAreaInput } from '@/db/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const row = getArea(id);

    if (!row) {
      return Response.json({ error: 'Area not found' }, { status: 404 });
    }

    return Response.json(row);
  } catch (err) {
    console.error('[GET /api/areas/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: UpdateAreaInput = await request.json();

    const row = updateArea(id, body);
    if (!row) {
      return Response.json({ error: 'Area not found' }, { status: 404 });
    }

    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/areas/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
