/**
 * Tail the supervised preview process's stdout/stderr.
 *
 * Cursor-based, like a Slack-style "give me everything since seq N."
 * The client polls every couple of seconds while the pane's log strip
 * is visible. Command mode only — Portless owns its own logs and the
 * client doesn't ask us for them.
 */

import type { NextRequest } from 'next/server';
import { getSupervisor } from '@/lib/preview/supervisor';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const cursor = Number(request.nextUrl.searchParams.get('cursor') ?? '0') || 0;
    const lines = getSupervisor().logsSince(id, cursor);
    const nextCursor = lines.length > 0 ? lines[lines.length - 1].seq : cursor;
    return Response.json({ cursor: nextCursor, lines });
  } catch (err) {
    console.error('[GET /api/workspaces/:id/preview/logs]', err);
    return Response.json({ error: 'preview_logs_failed', message: String(err) }, { status: 500 });
  }
}
