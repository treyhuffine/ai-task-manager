import type { NextRequest } from 'next/server';
import { getComputer, getWorkspace } from '@/lib/db/queries';
import { agentFoldersEverywhere, chooseAgentFolder, FolderError, removeFromComputer } from '@/lib/setups/folders';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; computerId: string }> };

type Scope = { ok: true; id: string; computerId: string } | { ok: false; response: Response };

async function scope(params: Params['params']): Promise<Scope> {
  const { id, computerId } = await params;
  if (!getWorkspace(id)) return { ok: false, response: Response.json({ error: 'not_found' }, { status: 404 }) };
  const computer = getComputer(computerId);
  if (!computer || computer.status !== 'active') {
    return { ok: false, response: Response.json({ error: 'not_found', message: 'No such computer.' }, { status: 404 }) };
  }
  return { ok: true, id, computerId };
}

/** The agent's project folder on that computer (docs/homes-spec.md §4.1). */
export async function PUT(request: NextRequest, { params }: Params) {
  const s = await scope(params);
  if (!s.ok) return s.response;
  const body = (await request.json().catch(() => ({}))) as { folder?: unknown };
  if (typeof body.folder !== 'string') return Response.json({ error: 'invalid_params', message: 'Choose a folder.' }, { status: 400 });
  try {
    await chooseAgentFolder(s.id, s.computerId, body.folder);
  } catch (err) {
    if (err instanceof FolderError) return Response.json({ error: 'not_there', message: err.message }, { status: 400 });
    throw err;
  }
  return Response.json({ computers: agentFoldersEverywhere(s.id) });
}

/** Take the agent off that computer. Nothing there is deleted. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const s = await scope(params);
  if (!s.ok) return s.response;
  try {
    await removeFromComputer(s.id, s.computerId);
  } catch (err) {
    if (err instanceof FolderError) return Response.json({ error: 'invalid_params', message: err.message }, { status: 400 });
    throw err;
  }
  return Response.json({ computers: agentFoldersEverywhere(s.id) });
}
