import { archiveReferenceFolder } from '@/lib/db/queries';
import { recycleForReferenceFolderChange } from '@/lib/executor/adapter';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Archive rather than delete, matching the rest of the app. Archiving also
 * frees the alias for reuse — the partial unique indexes only cover active
 * rows.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const row = archiveReferenceFolder(id);
    if (!row) return reply({ error: 'Reference folder not found' }, { status: 404 });
    // A removed folder has to stop being announced now, not next session.
    await recycleForReferenceFolderChange(row.workspaceId);
    return reply(row);
  } catch (err) {
    console.error('[POST /api/reference-folders/:id/archive]', err);
    return reply({ error: String(err) }, { status: 400 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
