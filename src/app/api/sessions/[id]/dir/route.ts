import type { NextRequest } from 'next/server';
import {
  createWorkspaceDir,
  deleteWorkspacePath,
} from '@/lib/workspaces/write-file';
import { openSessionWorktree, mapFileError } from '../_helpers';

/**
 * Directory CRUD for the file tree's "New Folder" / "Delete" affordances.
 *
 * POST body: `{ path: string }` — `mkdir -p`. Idempotent vs an existing dir.
 * DELETE `?path=...` — recursive remove (delegates to `deleteWorkspacePath`,
 *   which handles both file and dir kinds; we keep a separate route for
 *   semantic clarity at the call site).
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

    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return resolved.response;

    const result = await createWorkspaceDir(resolved.handle, body.path);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return mapFileError(err, '[POST /api/sessions/:id/dir]');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const relPath = request.nextUrl.searchParams.get('path');
    if (!relPath) {
      return Response.json({ error: 'Missing path parameter' }, { status: 400 });
    }

    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return resolved.response;

    const result = await deleteWorkspacePath(resolved.handle, relPath);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return mapFileError(err, '[DELETE /api/sessions/:id/dir]');
  }
}
