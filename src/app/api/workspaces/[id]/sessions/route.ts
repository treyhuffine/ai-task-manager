import type { NextRequest } from 'next/server';
import { listChatSessions, getWorkspace } from '@/lib/db/queries';
import { dispatchExecutionSession, WorkspaceNotFoundForDispatch } from '@/lib/sessions/dispatch';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const rows = listChatSessions({ workspace_id: id, status: 'active' });
    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/workspaces/:id/sessions]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: { label?: string; harness?: string; baseBranch?: string } =
      await request.json().catch(() => ({}));
    if (!getWorkspace(id)) {
      return Response.json({ error: 'Workspace not found' }, { status: 404 });
    }
    // Label is optional. Empty/missing → null on the row; the first user
    // message will derive a real label (see /api/sessions/[id]/messages).
    // baseBranch overrides the workspace default — used by "Create from"
    // to start an execution off a specific PR head, branch, or issue base.
    const row = await dispatchExecutionSession({
      workspaceId: id,
      label: body.label?.trim() || null,
      harness: body.harness,
      baseBranch: body.baseBranch?.trim() || null,
    });
    return Response.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof WorkspaceNotFoundForDispatch) {
      return Response.json({ error: 'Workspace not found' }, { status: 404 });
    }
    // Surface library error names so the client can branch on them.
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/workspaces/:id/sessions]', err);
    return Response.json({ error: name, message }, { status: 500 });
  }
}
