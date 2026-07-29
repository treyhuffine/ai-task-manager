import type { NextRequest } from 'next/server';
import { archiveReferenceFolder } from '@/lib/db/queries';
import { recycleForReferenceFolderChange } from '@/lib/executor/adapter';

/**
 * Archive rather than delete, matching the rest of the app. Archiving also
 * frees the alias for reuse — the partial unique indexes only cover active
 * rows.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = archiveReferenceFolder(id);
    if (!row) return Response.json({ error: 'Reference folder not found' }, { status: 404 });
    // A removed folder has to stop being announced now, not next session.
    await recycleForReferenceFolderChange(row.workspaceId);
    return Response.json(row);
  } catch (err) {
    console.error('[POST /api/reference-folders/:id/archive]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
