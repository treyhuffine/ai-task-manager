import type { NextRequest } from 'next/server';
import {
  createWorkspaceDir,
  deleteWorkspacePath,
} from '@/lib/workspaces/write-file';
import { writeOnOwner } from '@/lib/executor/owner-files';
import { whileAdmitted } from '@/lib/transfer/moving';
import { openSessionWorktree, mapFileError } from '../_helpers';

/**
 * Directory CRUD for the file tree's "New Folder" / "Delete" affordances.
 *
 * POST body: `{ path: string }` — `mkdir -p`. Idempotent vs an existing dir.
 * DELETE `?path=...` — recursive remove (delegates to `deleteWorkspacePath`,
 *   which handles both file and dir kinds; we keep a separate route for
 *   semantic clarity at the call site).
 */
async function handlePOST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
    if (!body || typeof body.path !== 'string') {
      return Response.json({ error: 'Body must be { path: string }' }, { status: 400 });
    }

    const owner = await writeOnOwner(id, { kind: 'create_dir', path: body.path });
    if (owner) return owner;

    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return resolved.response;

    const result = await createWorkspaceDir(resolved.handle, body.path);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return mapFileError(err, '[POST /api/sessions/:id/dir]');
  }
}

async function handleDELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const relPath = request.nextUrl.searchParams.get('path');
    if (!relPath) {
      return Response.json({ error: 'Missing path parameter' }, { status: 400 });
    }

    const owner = await writeOnOwner(id, { kind: 'delete', path: relPath });
    if (owner) return owner;

    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return resolved.response;

    const result = await deleteWorkspacePath(resolved.handle, relPath);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return mapFileError(err, '[DELETE /api/sessions/:id/dir]');
  }
}

/** A change to its files, counted while it runs: never under a move (P4 review). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return whileAdmitted(id, 'changing its files', () => handlePOST(request, context));
}

/** A change to its files, counted while it runs: never under a move (P4 review). */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return whileAdmitted(id, 'changing its files', () => handleDELETE(request, context));
}
