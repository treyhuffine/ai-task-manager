import type { NextRequest } from 'next/server';
import { getWorkspace, updateWorkspace } from '@/lib/db/queries';
import type { UpdateWorkspaceInput } from '@/db/types';

export async function GET(
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
