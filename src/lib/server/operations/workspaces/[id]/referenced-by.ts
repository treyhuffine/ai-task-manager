import { getWorkspace, listReferenceFoldersTargeting } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { isReadOnly } from '@/lib/reference-folders/read-only';
import { z as rpcZ } from 'zod/v4';

/**
 * Who points at this workspace (docs/reference-folders-spec.md Phase 3).
 *
 * References are one-way by design — frontend referencing backend does not
 * make backend reference frontend. That means a workspace has no way to know
 * it is being read unless we tell it, which is what this is for.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    if (!getWorkspace(id)) {
      return reply({ error: 'Workspace not found' }, { status: 404 });
    }
    const rows = listReferenceFoldersTargeting(id);
    return reply({
      referencedBy: rows.map(({ reference, ownerName }) => ({
        id: reference.id,
        alias: reference.alias,
        workspaceId: reference.workspaceId,
        // Null owner means a global reference: every workspace sees it.
        workspaceName: ownerName,
        readOnly: isReadOnly(reference),
      })),
    });
  } catch (err) {
    console.error('[GET /api/workspaces/:id/referenced-by]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
