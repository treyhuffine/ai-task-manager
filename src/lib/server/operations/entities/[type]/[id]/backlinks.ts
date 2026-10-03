import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Backlinks + outgoing links for a task or note. "Which notes/tasks link
 * to this one" (backlinks) and "what this one links to" (outgoing, with
 * unresolved targets flagged). Reads from the derived `entity_links` index;
 * the query layer repairs any pending sources first so the result is
 * transactionally consistent. See docs/entity-links-spec.md §9.
 */
import { listEntityLinksFor } from '@/lib/db/queries';

const LINK_TYPES = ['task', 'note'] as const;
type LinkType = (typeof LINK_TYPES)[number];

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { type, id } = rpcInput.params;
    if (!LINK_TYPES.includes(type as LinkType)) {
      return reply({ error: `invalid type: ${type}` }, { status: 400 });
    }
    if (!id) {
      return reply({ error: 'id required' }, { status: 400 });
    }
    return reply(listEntityLinksFor(type as LinkType, id));
  } catch (err) {
    console.error('[GET /api/entities/[type]/[id]/backlinks]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "type": rpcZ.string().min(1), "id": rpcZ.string().min(1) }).strict() }).strict();
