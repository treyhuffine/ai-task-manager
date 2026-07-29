import type { NextRequest } from 'next/server';
import { getWorkspace, listReferenceFoldersTargeting } from '@/lib/db/queries';

/**
 * Who points at this workspace (docs/reference-folders-spec.md Phase 3).
 *
 * References are one-way by design — frontend referencing backend does not
 * make backend reference frontend. That means a workspace has no way to know
 * it is being read unless we tell it, which is what this is for.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!getWorkspace(id)) {
      return Response.json({ error: 'Workspace not found' }, { status: 404 });
    }
    const rows = listReferenceFoldersTargeting(id);
    return Response.json({
      referencedBy: rows.map(({ reference, ownerName }) => ({
        id: reference.id,
        alias: reference.alias,
        workspaceId: reference.workspaceId,
        // Null owner means a global reference: every workspace sees it.
        workspaceName: ownerName,
      })),
    });
  } catch (err) {
    console.error('[GET /api/workspaces/:id/referenced-by]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
