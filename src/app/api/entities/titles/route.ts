/**
 * Batch, read-only title/status resolution for entity-link chips. Deliberately
 * separate from the per-entity GET routes, which bump `last_viewed_at` and
 * return full bodies — a document with many link chips must not mark all its
 * targets viewed or over-fetch. See docs/entity-links-spec.md §9.
 *
 *   GET /api/entities/titles?refs=task:<id>,note:<id>
 */
import { NextRequest } from 'next/server';
import { resolveEntityTitles, type EntityTitleRef } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';

export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
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
    return Response.json({ titles: resolveEntityTitles(refs) });
  } catch (err) {
    console.error('[GET /api/entities/titles]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
