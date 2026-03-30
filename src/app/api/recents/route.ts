import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { tasks, notes } from '@/lib/db/schema';
import { desc, isNotNull, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '10', 10);

    // Fetch recently viewed tasks
    const recentTasks = db
      .select({
        id: tasks.id,
        title: tasks.title,
        entity_type: sql<string>`'task'`.as('entity_type'),
        last_viewed_at: tasks.last_viewed_at,
      })
      .from(tasks)
      .where(isNotNull(tasks.last_viewed_at))
      .orderBy(desc(tasks.last_viewed_at))
      .limit(limit)
      .all();

    // Fetch recently viewed notes
    const recentNotes = db
      .select({
        id: notes.id,
        title: sql<string>`COALESCE(${notes.title}, substr(${notes.body}, 1, 60))`.as('title'),
        entity_type: sql<string>`'note'`.as('entity_type'),
        last_viewed_at: notes.last_viewed_at,
      })
      .from(notes)
      .where(isNotNull(notes.last_viewed_at))
      .orderBy(desc(notes.last_viewed_at))
      .limit(limit)
      .all();

    // Merge and sort by last_viewed_at, take top N
    const merged = [...recentTasks, ...recentNotes]
      .sort((a, b) => (b.last_viewed_at ?? '').localeCompare(a.last_viewed_at ?? ''))
      .slice(0, limit);

    return Response.json(merged);
  } catch (err) {
    console.error('[GET /api/recents]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
