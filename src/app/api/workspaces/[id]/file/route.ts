import type { NextRequest } from 'next/server';
import { mapFileError } from '@/lib/workspaces/file-http';
import { withCompression } from '@/lib/api/compression';
import { openWorkspaceFolder, readFolderFile } from '../_folder';

/**
 * Read one file from the agent's own folder. Same shape as
 * `/api/sessions/:id/file` (`?path=`, optional `?base=1` for the diff "old"
 * side). Read-only: editing from the agent view is out of scope
 * (docs/agents-view-spec.md §7), and a git agent's checkout is changed
 * through executions.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const relPath = request.nextUrl.searchParams.get('path');
    if (!relPath) return Response.json({ error: 'Missing path parameter' }, { status: 400 });
    const resolved = await openWorkspaceFolder(id);
    if (!resolved.ok) return resolved.response;
    return await readFolderFile(resolved.folder, relPath, request.nextUrl.searchParams.get('base') === '1');
  } catch (err) {
    return mapFileError(err, '[GET /api/workspaces/:id/file]');
  }
}
