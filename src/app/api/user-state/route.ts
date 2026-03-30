import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { userState } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const db = getDb();
    const row = db.select().from(userState).where(eq(userState.id, 1)).get();
    return Response.json(row);
  } catch (err) {
    console.error('[GET /api/user-state]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const row = db
      .update(userState)
      .set({ ...body, updated_at: new Date().toISOString() })
      .where(eq(userState.id, 1))
      .returning()
      .get();

    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/user-state]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
