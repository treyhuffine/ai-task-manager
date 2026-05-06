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
    const body: UpdateWorkspaceInput = await request.json();
    const row = updateWorkspace(id, body);
    if (!row) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/workspaces/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
