import type { NextRequest } from 'next/server';
import { listChatEvents } from '@/lib/db/queries';

/**
 * Returns chat_events rows. Attachments live on each row natively as
 * a JSON column (`Attachment[]`) — same shape as tasks/notes — so no
 * second query or join is needed. The transcript chip renderer reads
 * the marker tokens out of `content` and looks them up against the
 * row's `attachments` array.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? '1000');
    const offset = Number(request.nextUrl.searchParams.get('offset') ?? '0');
    const rows = listChatEvents(id, { limit, offset });
    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/sessions/:id/events]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
