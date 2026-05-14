import type { NextRequest } from 'next/server';
import { createWorkspaceFile } from '@/lib/workspaces/write-file';
import { openSessionWorktree, mapFileError } from '../../_helpers';

/**
 * Create an empty file at the given path. Distinct from PUT (upsert):
 * this one refuses to overwrite, so the tree's "New File" affordance
 * can surface a name-collision error instead of silently clobbering an
 * existing file the user forgot about.
 *
 * POST body: `{ path: string }`.
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

    const result = await createWorkspaceFile(resolved.handle, body.path);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return mapFileError(err, '[POST /api/sessions/:id/file/create]');
  }
}
