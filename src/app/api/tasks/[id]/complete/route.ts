import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { tasks, taskCompletions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!task) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const now = new Date().toISOString();

    if (task.recurrence) {
      // Recurring task: log completion, bump next_recurrence_at, keep active
      db.insert(taskCompletions).values({
        id: uuidv7(),
        task_id: id,
        completed_at: now,
        note: body.note ?? null,
      }).run();

      // Simple recurrence bump: parse "daily", "weekly", "monthly" or days
      const nextDate = computeNextRecurrence(task.recurrence, now);

      const updated = db
        .update(tasks)
        .set({
          next_recurrence_at: nextDate,
          last_progress_at: now,
          updated_at: now,
        })
        .where(eq(tasks.id, id))
        .returning()
        .get();

      return Response.json({ task: updated, recurring: true, next_recurrence_at: nextDate });
    } else {
      // One-time task: mark done
      const updated = db
        .update(tasks)
        .set({
          status: 'done',
          completed_at: now,
          updated_at: now,
        })
        .where(eq(tasks.id, id))
        .returning()
        .get();

      // Log completion record
      db.insert(taskCompletions).values({
        id: uuidv7(),
        task_id: id,
        completed_at: now,
        note: body.note ?? null,
      }).run();

      return Response.json({ task: updated, recurring: false });
    }
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 400 });
  }
}

function computeNextRecurrence(recurrence: string, fromDate: string): string {
  const date = new Date(fromDate);
  const lower = recurrence.toLowerCase();

  if (lower.includes('daily') || lower === '1d') {
    date.setDate(date.getDate() + 1);
  } else if (lower.includes('weekly') || lower === '1w') {
    date.setDate(date.getDate() + 7);
  } else if (lower.includes('monthly') || lower === '1m') {
    date.setMonth(date.getMonth() + 1);
  } else if (lower.includes('yearly') || lower === '1y') {
    date.setFullYear(date.getFullYear() + 1);
  } else {
    // Try to parse "Xd" pattern (e.g. "3d" = every 3 days)
    const match = lower.match(/^(\d+)d$/);
    if (match) {
      date.setDate(date.getDate() + parseInt(match[1], 10));
    } else {
      // Default: 7 days
      date.setDate(date.getDate() + 7);
    }
  }

  return date.toISOString();
}
