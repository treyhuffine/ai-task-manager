import { NextRequest } from 'next/server';
import type { CreateStreamInput } from '@/db/types';
import { createStream, listStream } from '@/lib/db/queries';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const rows = listStream({
      status: (params.get('status') as 'pending' | 'promoted' | 'dismissed' | null) ?? undefined,
      limit: params.get('limit') ? parseInt(params.get('limit')!, 10) : undefined,
      offset: params.get('offset') ? parseInt(params.get('offset')!, 10) : undefined,
    });
    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/stream]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateStreamInput = await request.json();

    if (!body.rawText) {
      return Response.json({ error: 'rawText is required' }, { status: 400 });
    }

    const row = createStream(body);
    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/stream]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
