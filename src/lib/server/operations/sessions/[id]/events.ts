import { CHAT_PAGE_SIZE } from '@/constants/chat';
import { toChatEventDTOs } from '@/lib/api/dto/chat-event';
import { listChatEvents } from '@/lib/db/queries';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Returns chat_events rows. Attachments live on each row natively as
 * a JSON column (`Attachment[]`) — same shape as tasks/notes — so no
 * second query or join is needed. The transcript chip renderer reads
 * the marker tokens out of `content` and looks them up against the
 * row's `attachments` array.
 */
// Compressed: this route can ship hundreds of KB of JSON, and Next 16
// does not compress route handlers. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const limit = Number(searchParams(rpcInput.query).get('limit') ?? String(CHAT_PAGE_SIZE));
    const offset = Number(searchParams(rpcInput.query).get('offset') ?? '0');
    // Backward-paging cursor: when present, return the page of events
    // strictly older than this id (drives transcript scroll-up).
    const before = searchParams(rpcInput.query).get('before') ?? undefined;
    const rows = listChatEvents(id, { limit, offset, before });
    // `raw` is 80% of a transcript page and almost never read. See
    // lib/api/dto/chat-event.ts — the SSE route projects identically, so a
    // transcript looks the same whether it arrived by fetch or by stream.
    return reply(toChatEventDTOs(rows));
  } catch (err) {
    console.error('[GET /api/sessions/:id/events]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "limit": rpcZ.string().optional(), "offset": rpcZ.string().optional(), "before": rpcZ.string().optional() }).strict().optional() }).strict();
