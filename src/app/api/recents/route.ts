import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { tasks, notes } from '@/lib/db/schema';
import { desc, isNotNull, sql } from 'drizzle-orm';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const db = getDb();
    const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '10', 10);

    // Fetch recently viewed tasks
    const recentTasks = db
      .select({
        id: tasks.id,
        title: tasks.title,
        entityType: sql<string>`'task'`.as('entityType'),
        lastViewedAt: tasks.lastViewedAt,
      })
      .from(tasks)
      .where(isNotNull(tasks.lastViewedAt))
      .orderBy(desc(tasks.lastViewedAt))
      .limit(limit)
      .all();

    // Fetch recently viewed notes
    const recentNotes = db
      .select({
        id: notes.id,
        title: sql<string>`COALESCE(${notes.title}, substr(${notes.body}, 1, 60))`.as('title'),
        entityType: sql<string>`'note'`.as('entityType'),
        lastViewedAt: notes.lastViewedAt,
        hasBody: sql<boolean>`(length(trim(${notes.body})) > 0)`.as('hasBody'),
      })
      .from(notes)
      .where(isNotNull(notes.lastViewedAt))
      .orderBy(desc(notes.lastViewedAt))
      .limit(limit)
      .all();

    // Merge and sort by lastViewedAt, take top N
    const merged = [...recentTasks, ...recentNotes]
      .sort((a, b) => (b.lastViewedAt ?? '').localeCompare(a.lastViewedAt ?? ''))
      .slice(0, limit);

    return Response.json(merged);
  } catch (err) {
    console.error('[GET /api/recents]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
