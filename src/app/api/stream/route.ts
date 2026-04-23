import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { stream } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { CreateStreamInput } from '@/db/types';
import { createStream } from '@/lib/db/queries';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const params = request.nextUrl.searchParams;

    const status = params.get('status');
    const limit = params.get('limit') ? parseInt(params.get('limit')!, 10) : 100;
    const offset = params.get('offset') ? parseInt(params.get('offset')!, 10) : 0;

    const rows = db
      .select()
      .from(stream)
      .where(status ? eq(stream.status, status as 'pending' | 'promoted' | 'dismissed') : undefined)
      .orderBy(desc(stream.created_at))
      .limit(limit)
      .offset(offset)
      .all();

    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/stream]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateStreamInput = await request.json();

    if (!body.raw_text) {
      return Response.json({ error: 'raw_text is required' }, { status: 400 });
    }

    const row = createStream(body);
    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/stream]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
