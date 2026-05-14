import type { NextRequest } from 'next/server';
import { renameWorkspacePath } from '@/lib/workspaces/write-file';
import { openSessionWorktree, mapFileError } from '../../_helpers';

/**
 * Move/rename a file or directory inside the worktree.
 * POST body: `{ from: string, to: string }`. Refuses to overwrite an
 * existing target — `write-file.ts` raises `exists` (409) so the UI
 * can prompt the user to pick a different name.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { from?: unknown; to?: unknown }
      | null;
    if (!body || typeof body.from !== 'string' || typeof body.to !== 'string') {
      return Response.json(
        { error: 'Body must be { from: string, to: string }' },
        { status: 400 },
      );
    }

    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return resolved.response;

    const result = await renameWorkspacePath(resolved.handle, body.from, body.to);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return mapFileError(err, '[POST /api/sessions/:id/file/rename]');
  }
}
