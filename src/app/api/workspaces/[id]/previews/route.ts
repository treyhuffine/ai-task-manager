import type { NextRequest } from 'next/server';
import { getWorkspace } from '@/lib/db/queries';
import { listWorkspacePreviews } from '@/lib/preview/service';
import { previewErrorResponse } from '@/lib/preview/route-helpers';
import { withCompression } from '@/lib/api/compression';

export const runtime = 'nodejs';

/**
 * The previews on this agent's active executions, with live state, for the
 * agent view's Preview tab and Overview. Starting, stopping and pinning stay
 * on `/api/executions/:id/preview/*`. Reading here never keeps a preview
 * warm. See `listWorkspacePreviews`.
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
    if (!getWorkspace(id)) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    return Response.json({ previews: listWorkspacePreviews(id) });
  } catch (err) {
    return previewErrorResponse(err, 'GET /api/workspaces/:id/previews');
  }
}
