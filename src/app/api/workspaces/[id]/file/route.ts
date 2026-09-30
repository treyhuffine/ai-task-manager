import type { NextRequest } from 'next/server';
import { mapFileError } from '@/lib/workspaces/file-http';
import { withCompression } from '@/lib/api/compression';
import { agentFolderResponse, agentFolderWrite } from '../_folder';

/**
 * One file in the agent's own folder, on the device the agent lives on
 * (P3.5), the same surface as `/api/sessions/:id/file`:
 *
 * GET `?path=` (optional `?base=1` for the diff "old" side).
 * PUT `?path=` with `{ content: string }`: upsert, creating parent dirs.
 * DELETE `?path=`: remove the file, or the directory recursively.
 *
 * Writes are the person's, from the Files tab. An archived agent is
 * read-only (409). See `../_folder.ts`.
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
    return await agentFolderResponse(id, { kind: 'file', path: relPath, base: request.nextUrl.searchParams.get('base') === '1' });
  } catch (err) {
    return mapFileError(err, '[GET /api/workspaces/:id/file]');
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const relPath = request.nextUrl.searchParams.get('path');
    if (!relPath) return Response.json({ error: 'Missing path parameter' }, { status: 400 });
    const body = (await request.json().catch(() => null)) as { content?: unknown } | null;
    if (!body || typeof body.content !== 'string') {
      return Response.json({ error: 'Body must be { content: string }' }, { status: 400 });
    }
    return await agentFolderWrite(id, { kind: 'write', path: relPath, content: body.content });
  } catch (err) {
    return mapFileError(err, '[PUT /api/workspaces/:id/file]');
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
    return await agentFolderWrite(id, { kind: 'delete', path: relPath });
  } catch (err) {
    return mapFileError(err, '[DELETE /api/workspaces/:id/file]');
  }
}
