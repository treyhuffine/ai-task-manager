import { revertEntityTo } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Restore a note/task to a prior version's snapshot — the "undo" behind the
 * in-document chat's diff modal. The restore routes through the normal update
 * path, so it's itself recorded as a new (`system`) version and is undoable in
 * turn. Returns `{ entityType, entityId, record }`.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const result = revertEntityTo(id);
    if (!result) {
      return reply({ error: 'Version not found' }, { status: 404 });
    }
    return reply(result);
  } catch (err) {
    console.error('[POST /api/entity-versions/:id/revert]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
