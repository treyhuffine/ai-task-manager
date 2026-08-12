import type { NextRequest } from 'next/server';
import { listChatEvents } from '@/lib/db/queries';
import { CHAT_PAGE_SIZE } from '@/constants/chat';
import { withCompression } from '@/lib/api/compression';
import { toChatEventDTOs } from '@/lib/api/dto/chat-event';

/**
 * Returns chat_events rows. Attachments live on each row natively as
 * a JSON column (`Attachment[]`) — same shape as tasks/notes — so no
 * second query or join is needed. The transcript chip renderer reads
 * the marker tokens out of `content` and looks them up against the
 * row's `attachments` array.
 */
// Compressed: this route can ship hundreds of KB of JSON, and Next 16
// does not compress route handlers. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? String(CHAT_PAGE_SIZE));
    const offset = Number(request.nextUrl.searchParams.get('offset') ?? '0');
    // Backward-paging cursor: when present, return the page of events
    // strictly older than this id (drives transcript scroll-up).
    const before = request.nextUrl.searchParams.get('before') ?? undefined;
    const rows = listChatEvents(id, { limit, offset, before });
    // `raw` is 80% of a transcript page and almost never read. See
    // lib/api/dto/chat-event.ts — the SSE route projects identically, so a
    // transcript looks the same whether it arrived by fetch or by stream.
    return Response.json(toChatEventDTOs(rows));
  } catch (err) {
    console.error('[GET /api/sessions/:id/events]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
