import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { areas } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { CreateAreaInput } from '@/db/types';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const params = request.nextUrl.searchParams;

    const status = params.get('status') ?? 'active';

    const rows = db
      .select()
      .from(areas)
      .where(status !== 'all' ? eq(areas.status, status as 'active' | 'inactive' | 'archived') : undefined)
      .orderBy(asc(areas.sort_order))
      .all();

    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/areas]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body: CreateAreaInput = await request.json();

    if (!body.name) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const now = new Date().toISOString();

    const row = db
      .insert(areas)
      .values({
        ...body,
        id: uuidv7(),
        status: body.status ?? 'active',
        created_at: now,
        updated_at: now,
      })
      .returning()
      .get();

    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/areas]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
