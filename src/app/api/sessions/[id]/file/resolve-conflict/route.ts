import type { NextRequest } from 'next/server';
import { resolveWorkspaceConflict } from '@/lib/workspaces/write-file';
import { openSessionWorktree, mapFileError } from '../../_helpers';

/**
 * Resolve a merge conflict for a single file from the execution view's
 * conflict resolver. Body: `{ path: string, content: string }` where
 * `content` is the fully-resolved file (no conflict markers). Writes the
 * content and `git add`s the path so git records the conflict as resolved.
 *
 * Separate from `PUT /file` (a bare write, no staging) because staging is
 * exactly what turns "unmerged" into "resolved" — a plain Save must not
 * silently mark a conflict done.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { path?: unknown; content?: unknown }
      | null;

    if (!body || typeof body.path !== 'string' || !body.path) {
      return Response.json({ error: 'Body must include a path string' }, { status: 400 });
    }
    if (typeof body.content !== 'string') {
      return Response.json({ error: 'Body must include content string' }, { status: 400 });
    }

    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return resolved.response;

    const result = await resolveWorkspaceConflict(resolved.handle, body.path, body.content);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return mapFileError(err, '[POST /api/sessions/:id/file/resolve-conflict]');
  }
}
