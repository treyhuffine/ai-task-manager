import path from 'node:path';
import type { NextRequest } from 'next/server';
import { getWorkspace, updateWorkspace, WorkspaceFieldError } from '@/lib/db/queries';
import type { UpdateWorkspaceInput } from '@/db/types';
import { withCompression } from '@/lib/api/compression';
import { recycleAgentMainChats, recycleWorkspaceSessions } from '@/lib/executor/adapter';

/** Fields every live session of the agent receives at spawn: its executions and its main chat. */
const SESSION_FIELDS = ['browserEnabled', 'instructions', 'cwd', 'isGit'] as const;
/** Fields only the agent's main chat receives (they are in its brief, not in executions). */
const MAIN_CHAT_FIELDS = ['name', 'purpose'] as const;

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
    // A new folder for the agent on this computer is a new setup (§4.2). Set
    // it up first: the new folder's `.ri.local.json` is written before the
    // old one is cleared, and nothing in the database changes if it fails.
    if (typeof body.cwd === 'string') {
      if (!getWorkspace(id)) return Response.json({ error: 'Workspace not found' }, { status: 404 });
      const { setHomeFolder } = await import('@/lib/setups/home-context');
      const { SetupError } = await import('@/lib/setups/service');
      try {
        await setHomeFolder(id, path.resolve(body.cwd));
      } catch (err) {
        if (err instanceof SetupError || (err instanceof Error && err.name === 'SetupFileConflictError')) {
          return Response.json({ error: err.message }, { status: 400 });
        }
        throw err;
      }
      body.cwd = path.resolve(body.cwd);
    }
    const row = updateWorkspace(id, body);
    if (!row) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    // Session config is fixed at spawn (the browser changes the tool set, the
    // instructions and folder are read at spawn), so recycle live sessions to
    // apply a change now rather than only on the next session. The next
    // message resumes the same chat, and a session mid-turn is recycled when
    // its turn ends. Name and purpose only reach the agent's main chat.
    if (SESSION_FIELDS.some((field) => field in body)) await recycleWorkspaceSessions(id);
    else if (MAIN_CHAT_FIELDS.some((field) => field in body)) await recycleAgentMainChats(id);
    return Response.json(row);
  } catch (err) {
    if (err instanceof WorkspaceFieldError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error('[PATCH /api/workspaces/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
