import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { stream } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { CreateStreamInput } from '@/db/types';
import { upsertEmbedding, buildEmbeddingText } from '@/lib/embeddings/embed';
import { syncEntity } from '@/lib/export/mirror';

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
    const db = getDb();
    const body: CreateStreamInput = await request.json();

    if (!body.raw_text) {
      return Response.json({ error: 'raw_text is required' }, { status: 400 });
    }

    const row = db
      .insert(stream)
      .values({
        ...body,
        id: uuidv7(),
        source: body.source ?? 'capture',
        status: body.status ?? 'pending',
        created_at: new Date().toISOString(),
      })
      .returning()
      .get();

    void upsertEmbedding('stream', row.id, buildEmbeddingText('stream', row));
    void syncEntity('stream', row.id);
    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/stream]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
