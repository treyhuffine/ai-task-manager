import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { notes } from '@/lib/db/schema';
import { eq, and, desc, type SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { CreateNoteInput } from '@/db/types';
import { upsertEmbedding, buildEmbeddingText } from '@/lib/embeddings/embed';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const params = request.nextUrl.searchParams;

    const conditions: SQL[] = [];

    if (params.get('area_id')) {
      conditions.push(eq(notes.area_id, params.get('area_id')!));
    }

    if (params.get('task_id')) {
      conditions.push(eq(notes.task_id, params.get('task_id')!));
    }

    if (params.get('status')) {
      conditions.push(eq(notes.status, params.get('status') as 'active' | 'archived'));
    }

    const limit = params.get('limit') ? parseInt(params.get('limit')!, 10) : 10000;
    const offset = params.get('offset') ? parseInt(params.get('offset')!, 10) : 0;

    const rows = db
      .select()
      .from(notes)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(notes.created_at))
      .limit(limit)
      .offset(offset)
      .all();

    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/notes]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body: CreateNoteInput = await request.json();

    if (!body.body) {
      return Response.json(
        { error: 'body is required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const row = db
      .insert(notes)
      .values({
        ...body,
        id: uuidv7(),
        status: body.status ?? 'active',
        context_tags: body.context_tags ?? [],
        created_at: now,
        updated_at: now,
      })
      .returning()
      .get();

    void upsertEmbedding('note', row.id, buildEmbeddingText('note', row));
    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/notes]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
