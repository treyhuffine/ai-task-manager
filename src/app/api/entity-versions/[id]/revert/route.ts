import { NextRequest } from 'next/server';
import { revertEntityTo } from '@/lib/db/queries';

/**
 * Restore a note/task to a prior version's snapshot — the "undo" behind the
 * in-document chat's diff modal. The restore routes through the normal update
 * path, so it's itself recorded as a new (`system`) version and is undoable in
 * turn. Returns `{ entityType, entityId, record }`.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = revertEntityTo(id);
    if (!result) {
      return Response.json({ error: 'Version not found' }, { status: 404 });
    }
    return Response.json(result);
  } catch (err) {
    console.error('[POST /api/entity-versions/:id/revert]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
