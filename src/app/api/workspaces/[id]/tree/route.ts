import type { NextRequest } from 'next/server';
import { withCompression } from '@/lib/api/compression';
import { listFolderTree, openWorkspaceFolder } from '../_folder';

/**
 * Flat file list of the agent's own folder, for the agent view's Files tab.
 * Same shape as `/api/sessions/:id/tree`: git folders list tracked and
 * untracked files with status flags, bare folders walk the tree with the
 * heavyweight directories trimmed. Files the agent copies into worktrees
 * (`filesToCopy`, e.g. `.env*`) are surfaced even though git ignores them.
 * A detached HEAD lists without status flags (see `_folder.ts`).
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const resolved = await openWorkspaceFolder(id);
    if (!resolved.ok) return resolved.response;
    return Response.json({ entries: await listFolderTree(resolved.folder) });
  } catch (err) {
    console.error('[GET /api/workspaces/:id/tree]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
