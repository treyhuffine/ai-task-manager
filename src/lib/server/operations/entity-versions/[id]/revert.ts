import { revertEntityTo, isBodyRevisionConflict, isTeamError } from '@/lib/db/queries';
import { requireBodyRevision, sharedCaller } from '@/lib/team/shared-work';
import { getRequestKey } from '@/lib/auth/request-key';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Restore a note/task to a prior version's snapshot — the "undo" behind the
 * in-document chat's diff modal. The restore routes through the normal update
 * path, so it's itself recorded as a new (`system`) version and is undoable in
 * turn. Returns `{ entityType, entityId, record }`.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const key = getRequestKey(request.headers);
    requireBodyRevision(sharedCaller(key), { body: true }, rpcInput.body.expectedBodyRevision);
    const result = revertEntityTo(id, { actorMemberId: key?.scope === 'member' ? key.memberId : null }, rpcInput.body);
    if (!result) {
      return reply({ error: 'Version not found' }, { status: 404 });
    }
    return reply(result);
  } catch (err) {
    if (isBodyRevisionConflict(err)) return reply({ error: err.code, details: err.current, message: err.message }, { status: 409 });
    if (isTeamError(err)) return reply({ error: err.code, message: err.message }, { status: err.code === 'invalid' ? 400 : 403 });
    console.error('[POST /api/entity-versions/:id/revert]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ expectedBodyRevision: rpcZ.number().int().nonnegative().optional() }).strict().default({}) }).strict();
