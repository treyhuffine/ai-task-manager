import type { NextRequest } from 'next/server';
import { listChatEvents } from '@/lib/db/queries';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? '1000');
    const offset = Number(request.nextUrl.searchParams.get('offset') ?? '0');
    const rows = listChatEvents(id, { limit, offset });
    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/sessions/:id/events]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
