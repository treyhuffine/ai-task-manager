import type { NextRequest } from 'next/server';
import { getChatSession, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import {
  readWorkspaceFile,
  readBaseFile,
  FileReadError,
} from '@/lib/workspaces/read-file';
import { writeWorkspaceFile, deleteWorkspacePath } from '@/lib/workspaces/write-file';
import { openSessionWorktree, mapFileError } from '../_helpers';

/**
 * Single-file CRUD for the execution view's file viewer.
 *
 * GET — read content (with optional `?base=1` for the diff "old" side).
 * PUT — upsert file content. Body: `{ content: string }`. Creates parent
 *       dirs if missing. Used both by Save (existing file) and the
 *       create-then-edit flow (the tree's "New File" mints an empty file
 *       up front, so by the time Save fires the path always exists).
 * DELETE — remove the path (file or recursive dir).
 *
 * Both mutations stay deliberately small — no checkpointing, no git add,
 * no diff invalidation here. The client invalidates the React Query
 * caches that depend on worktree state once the route returns; git
 * status flips in/out via the same `tree` refetch path the agent uses.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const relPath = request.nextUrl.searchParams.get('path');
    const wantBase = request.nextUrl.searchParams.get('base') === '1';

    if (!relPath) {
      return Response.json({ error: 'Missing path parameter' }, { status: 400 });
    }

    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.workspace_id || !session.worktree_path) {
      return Response.json({ error: 'Workspace has no worktree' }, { status: 404 });
    }

    const ws = getWorkspace(session.workspace_id);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });

    const handle = await openWorktreeHandle(session, ws.cwd);
    if (!handle) return Response.json({ error: 'Worktree unavailable' }, { status: 404 });

    if (wantBase) {
      const content = await readBaseFile(handle, relPath);
      return Response.json({
        path: relPath,
        content,
        encoding: 'utf8',
        mime: 'text/plain',
        size: content.length,
        isBinary: false,
      });
    }

    const file = await readWorkspaceFile(handle, relPath);
    return Response.json(file);
  } catch (err) {
    if (err instanceof FileReadError) {
      const status =
        err.code === 'not_found' ? 404 :
        err.code === 'invalid_path' ? 400 :
        err.code === 'is_directory' ? 400 : 500;
      return Response.json({ error: err.message, code: err.code }, { status });
    }
    console.error('[GET /api/sessions/:id/file]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const relPath = request.nextUrl.searchParams.get('path');
    if (!relPath) {
      return Response.json({ error: 'Missing path parameter' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { content?: unknown } | null;
    if (!body || typeof body.content !== 'string') {
      return Response.json({ error: 'Body must be { content: string }' }, { status: 400 });
    }

    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return resolved.response;

    const result = await writeWorkspaceFile(resolved.handle, relPath, body.content);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return mapFileError(err, '[PUT /api/sessions/:id/file]');
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
    return mapFileError(err, '[DELETE /api/sessions/:id/file]');
  }
}
