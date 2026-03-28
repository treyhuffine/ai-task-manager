import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, inArray, and, desc, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { CreateTaskInput } from '@/db/types';
import { upsertEmbedding, buildEmbeddingText } from '@/lib/embeddings/embed';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const params = request.nextUrl.searchParams;

    const conditions: SQL[] = [];

    const status = params.get('status');
    if (status) {
      const statuses = status.split(',') as ('active' | 'done' | 'archived')[];
      if (statuses.length === 1) {
        conditions.push(eq(tasks.status, statuses[0]));
      } else {
        conditions.push(inArray(tasks.status, statuses));
      }
    }

    if (params.get('area_id')) {
      conditions.push(eq(tasks.area_id, params.get('area_id')!));
    }

    if (params.get('parent_id')) {
      conditions.push(eq(tasks.parent_id, params.get('parent_id')!));
    }

    if (params.get('energy')) {
      conditions.push(eq(tasks.energy, params.get('energy') as 'deep' | 'light'));
    }

    if (params.get('q')) {
      conditions.push(sql`${tasks.title} LIKE ${'%' + params.get('q')! + '%'}`);
    }

    const limit = params.get('limit') ? parseInt(params.get('limit')!, 10) : 10000;
    const offset = params.get('offset') ? parseInt(params.get('offset')!, 10) : 0;

    const rows = db
      .select()
      .from(tasks)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`sort_key ASC NULLS LAST`, desc(tasks.created_at))
      .limit(limit)
      .offset(offset)
      .all();

    return Response.json(rows);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body: CreateTaskInput = await request.json();

    if (!body.title || !body.raw_input) {
      return Response.json(
        { error: 'title and raw_input are required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const row = db
      .insert(tasks)
      .values({
        ...body,
        id: uuidv7(),
        status: body.status ?? 'active',
        context_tags: body.context_tags ?? [],
        attachments: body.attachments ?? [],
        times_deferred: 0,
        created_at: now,
        updated_at: now,
      })
      .returning()
      .get();

    void upsertEmbedding('task', row.id, buildEmbeddingText('task', row));
    return Response.json(row, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
