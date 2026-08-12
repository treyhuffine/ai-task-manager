import type { NextRequest } from 'next/server';
import { getWorkspace, updateWorkspace } from '@/lib/db/queries';
import type { UpdateWorkspaceInput } from '@/db/types';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = getWorkspace(id);
    if (!row) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    console.error('[GET /api/workspaces/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    // `connectorScopes` is security-relevant (it governs what a workspace's executions may touch) and
    // must go through PUT /connector-scopes, which validates pins and recycles live sessions. Strip it
    // here so the generic PATCH can't write scopes unvalidated and without a session recycle.
    const { connectorScopes: _ignored, ...body } = (await request.json()) as UpdateWorkspaceInput;
    const row = updateWorkspace(id, body);
    if (!row) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/workspaces/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
