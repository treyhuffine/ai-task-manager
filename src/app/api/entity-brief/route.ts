import { getNote, getTask } from '@/lib/db/queries';
import { ensureBrief, getBriefState, type BriefEntity } from '@/lib/briefs/brief';
import type { BriefEntityType } from '@/lib/briefs/types';
import { withCompression } from '@/lib/api/compression';

/**
 * The agent's brief of one note or task (see `src/lib/briefs/`).
 *
 *   GET  ?entityType=task|note&entityId=<id>
 *        Never blocks: returns the cached state (`inline | fresh | stale |
 *        missing`) so the UI can paint immediately and decide whether to ask
 *        for a generation.
 *   POST { entityType, entityId }
 *        Ensures a fresh brief: inline and fresh states return at once,
 *        stale and missing ones generate through the subscription harness
 *        (deduped per entity) and return when done.
 *
 * Both read the entity through `queries.ts` and hash its CURRENT content, so
 * a brief is only ever reported fresh against what is actually stored.
 */

function parseEntity(source: { entityType?: unknown; entityId?: unknown }):
  | { entityType: BriefEntityType; entityId: string }
  | null {
  const { entityType, entityId } = source;
  if ((entityType !== 'task' && entityType !== 'note') || typeof entityId !== 'string' || !entityId) {
    return null;
  }
  return { entityType, entityId };
}

function loadEntity(entityType: BriefEntityType, entityId: string): BriefEntity | undefined {
  return entityType === 'task' ? getTask(entityId) : getNote(entityId);
}

export const GET = withCompression(handleGET);

async function handleGET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ref = parseEntity({
    entityType: searchParams.get('entityType') ?? undefined,
    entityId: searchParams.get('entityId') ?? undefined,
  });
  if (!ref) {
    return Response.json({ error: 'entityType (task|note) and entityId are required' }, { status: 400 });
  }
  const entity = loadEntity(ref.entityType, ref.entityId);
  if (!entity) return Response.json({ error: `${ref.entityType} not found` }, { status: 404 });
  try {
    return Response.json({ state: getBriefState(ref.entityType, entity) });
  } catch (err) {
    console.error('[GET /api/entity-brief]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const ref = parseEntity((body ?? {}) as { entityType?: unknown; entityId?: unknown });
  if (!ref) {
    return Response.json({ error: 'entityType (task|note) and entityId are required' }, { status: 400 });
  }
  const entity = loadEntity(ref.entityType, ref.entityId);
  if (!entity) return Response.json({ error: `${ref.entityType} not found` }, { status: 404 });
  try {
    const state = await ensureBrief(ref.entityType, entity);
    return Response.json({ state });
  } catch (err) {
    console.error('[POST /api/entity-brief]', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: 'brief_failed', message }, { status: 502 });
  }
}
