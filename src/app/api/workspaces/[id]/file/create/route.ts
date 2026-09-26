import type { NextRequest } from 'next/server';
import { mapFileError } from '@/lib/workspaces/file-http';
import { createWorkspaceFile } from '@/lib/workspaces/write-file';
import { openWritableWorkspaceFolder } from '../../_folder';

/**
 * Create an empty file in the agent's folder, refusing to overwrite (409),
 * so the tree's "New File" can report a name collision. Mirrors
 * `/api/sessions/:id/file/create`. POST body: `{ path: string }`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
    if (!body || typeof body.path !== 'string') {
      return Response.json({ error: 'Body must be { path: string }' }, { status: 400 });
    }
    const resolved = openWritableWorkspaceFolder(id);
    if (!resolved.ok) return resolved.response;
    return Response.json({ ok: true, ...(await createWorkspaceFile(resolved.folder, body.path)) });
  } catch (err) {
    return mapFileError(err, '[POST /api/workspaces/:id/file/create]');
  }
}
