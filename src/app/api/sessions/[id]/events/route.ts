import type { NextRequest } from 'next/server';
import { listChatEvents, listSessionPastedAttachments } from '@/lib/db/queries';

/**
 * Returns each chat_event with `pasted_attachments` joined in for the
 * subset that have any. Single-pass response so the transcript chip
 * renderer doesn't need a second round-trip per `[[paste:id]]` marker.
 *
 * The attachment payload is text-only (pasted-text kind); image and
 * binary kinds will need their own join when those land.
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
    const attachmentsByMarker = listSessionPastedAttachments(id);

    // Group by event_id once, then attach the per-event slice. Avoids
    // an O(events * attachments) sweep at the cost of a Map allocation.
    const byEvent = new Map<string, Array<{ id: string; filename: string; content: string }>>();
    for (const [marker_id, row] of attachmentsByMarker) {
      const list = byEvent.get(row.event_id);
      const entry = { id: marker_id, filename: row.filename, content: row.content };
      if (list) list.push(entry);
      else byEvent.set(row.event_id, [entry]);
    }

    const enriched = rows.map((r) => {
      const atts = byEvent.get(r.id);
      return atts ? { ...r, pasted_attachments: atts } : r;
    });

    return Response.json(enriched);
  } catch (err) {
    console.error('[GET /api/sessions/:id/events]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
