/**
 * Backlinks + outgoing links for a task or note. "Which notes/tasks link
 * to this one" (backlinks) and "what this one links to" (outgoing, with
 * unresolved targets flagged). Reads from the derived `entity_links` index;
 * the query layer repairs any pending sources first so the result is
 * transactionally consistent. See docs/entity-links-spec.md §9.
 */
import { NextRequest } from 'next/server';
import { listEntityLinksFor } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';

const LINK_TYPES = ['task', 'note'] as const;
type LinkType = (typeof LINK_TYPES)[number];

export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  try {
    const { type, id } = await params;
    if (!LINK_TYPES.includes(type as LinkType)) {
      return Response.json({ error: `invalid type: ${type}` }, { status: 400 });
    }
    if (!id) {
      return Response.json({ error: 'id required' }, { status: 400 });
    }
    return Response.json(listEntityLinksFor(type as LinkType, id));
  } catch (err) {
    console.error('[GET /api/entities/[type]/[id]/backlinks]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
