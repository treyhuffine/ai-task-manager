import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Batch, read-only title/status resolution for entity-link chips. Deliberately
 * separate from the per-entity GET routes, which bump `last_viewed_at` and
 * return full bodies — a document with many link chips must not mark all its
 * targets viewed or over-fetch. See docs/entity-links-spec.md §9.
 *
 *   GET /api/entities/titles?refs=task:<id>,note:<id>
 */
import { resolveEntityTitles, type EntityTitleRef } from '@/lib/db/queries';

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  try {
    const url = new URL(request.url);
    const raw = url.searchParams.get('refs') ?? '';
    const refs: EntityTitleRef[] = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const idx = s.indexOf(':');
        return { type: s.slice(0, idx), id: s.slice(idx + 1) };
      })
      .filter((r): r is EntityTitleRef => (r.type === 'task' || r.type === 'note') && !!r.id);
    return reply({ titles: resolveEntityTitles(refs) });
  } catch (err) {
    console.error('[GET /api/entities/titles]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "refs": rpcZ.string().optional() }).strict().optional() }).strict().default({});
