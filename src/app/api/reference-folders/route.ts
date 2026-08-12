import type { NextRequest } from 'next/server';
import { createReferenceFolder, ReferenceFolderError } from '@/lib/db/queries';
import { listResolvedReferenceFolders, resolveReferenceFolder } from '@/lib/reference-folders/resolve';
import { recycleForReferenceFolderChange } from '@/lib/executor/adapter';
import { getWorkspace } from '@/lib/db/queries';
import type { CreateReferenceFolderInput } from '@/db/types';
import { withCompression } from '@/lib/api/compression';

/** Map the query layer's typed failures onto HTTP without leaking stack traces. */
function statusForReferenceError(code: ReferenceFolderError['code']): number {
  if (code === 'not_found') return 404;
  if (code === 'conflict') return 409;
  return 400;
}

/**
 * Reference folders visible from a workspace: its own rows plus every global
 * one, resolved to absolute paths with existence and git state attached so the
 * settings list renders in a single round trip.
 *
 * `?workspaceId=` omitted lists the global rows alone.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspaceId');
    const consumerCwd = workspaceId ? getWorkspace(workspaceId)?.cwd ?? null : null;
    const rows = await listResolvedReferenceFolders(workspaceId, { consumerCwd });
    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/reference-folders]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateReferenceFolderInput;
    const row = createReferenceFolder(body);
    // Live sessions cache their config at spawn, so a new folder is invisible
    // to them until they recycle.
    await recycleForReferenceFolderChange(row.workspaceId);
    // Resolve on the way out so the client can render the new row (path, git,
    // broken badge) without refetching the whole list.
    const consumerCwd = row.workspaceId ? getWorkspace(row.workspaceId)?.cwd ?? null : null;
    const resolved = await resolveReferenceFolder(row, { consumerCwd });
    return Response.json(resolved ?? row, { status: 201 });
  } catch (err) {
    if (err instanceof ReferenceFolderError) {
      return Response.json(
        { error: err.message, code: err.code },
        { status: statusForReferenceError(err.code) },
      );
    }
    console.error('[POST /api/reference-folders]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
