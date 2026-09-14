import type { NextRequest } from 'next/server';
import { getDeadlineTasks } from '@/lib/db/queries';

/**
 * Real hard deadlines that are overdue or due within a window (default 7 days),
 * newest-deadline-last. Deterministic — a plain status+deadline query with NO
 * model call — so the deadline surface stays live even when Deck generation is
 * unavailable. Powers the always-on deadline band above the deck.
 *
 * `?withinDays=N` (0..60) widens/narrows the upcoming window; overdue is always
 * included.
 */
export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get('withinDays');
    let withinDays: number | undefined;
    if (raw != null) {
      const n = Number(raw);
      withinDays = Number.isFinite(n) ? Math.max(0, Math.min(60, Math.trunc(n))) : undefined;
    }
    return Response.json(getDeadlineTasks({ withinDays }));
  } catch (err) {
    console.error('[GET /api/tasks/deadlines]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
