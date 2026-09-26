import type { NextRequest } from 'next/server';
import { mapFileError } from '@/lib/workspaces/file-http';
import { createWorkspaceDir, deleteWorkspacePath } from '@/lib/workspaces/write-file';
import { openWritableWorkspaceFolder } from '../_folder';

/**
 * Directory create and delete for the agent folder's tree. Mirrors
 * `/api/sessions/:id/dir`.
 *
 * POST `{ path: string }`: `mkdir -p`, fine if it already exists.
 * DELETE `?path=`: recursive remove.
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
    return Response.json({ ok: true, ...(await createWorkspaceDir(resolved.folder, body.path)) });
  } catch (err) {
    return mapFileError(err, '[POST /api/workspaces/:id/dir]');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const relPath = request.nextUrl.searchParams.get('path');
    if (!relPath) return Response.json({ error: 'Missing path parameter' }, { status: 400 });
    const resolved = openWritableWorkspaceFolder(id);
    if (!resolved.ok) return resolved.response;
    return Response.json({ ok: true, ...(await deleteWorkspacePath(resolved.folder, relPath)) });
  } catch (err) {
    return mapFileError(err, '[DELETE /api/workspaces/:id/dir]');
  }
}
