import type { NextRequest } from 'next/server';
import { mapFileError } from '@/lib/workspaces/file-http';
import { resolveWorkspaceConflict } from '@/lib/workspaces/write-file';
import { openWritableWorkspaceFolder } from '../../_folder';

/**
 * Resolve a merge conflict in the agent's folder, say after a merge in the
 * checkout: write the resolved file and `git add` it so git records the
 * conflict as resolved. Mirrors `/api/sessions/:id/file/resolve-conflict`.
 * POST body: `{ path: string, content: string }`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { path?: unknown; content?: unknown } | null;
    if (!body || typeof body.path !== 'string' || !body.path) {
      return Response.json({ error: 'Body must include a path string' }, { status: 400 });
    }
    if (typeof body.content !== 'string') {
      return Response.json({ error: 'Body must include content string' }, { status: 400 });
    }
    const resolved = openWritableWorkspaceFolder(id);
    if (!resolved.ok) return resolved.response;
    return Response.json({ ok: true, ...(await resolveWorkspaceConflict(resolved.folder, body.path, body.content)) });
  } catch (err) {
    return mapFileError(err, '[POST /api/workspaces/:id/file/resolve-conflict]');
  }
}
