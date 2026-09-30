import type { NextRequest } from 'next/server';
import { getDevice, getWorkspace } from '@/lib/db/queries';
import { agentFoldersEverywhere, chooseWorkspaceFolder, FolderError, removeFromDevice } from '@/lib/setups/folders';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; deviceId: string }> };

type Scope = { ok: true; id: string; deviceId: string } | { ok: false; response: Response };

async function scope(params: Params['params']): Promise<Scope> {
  const { id, deviceId } = await params;
  if (!getWorkspace(id)) return { ok: false, response: Response.json({ error: 'not_found' }, { status: 404 }) };
  const device = getDevice(deviceId);
  if (!device || device.status !== 'active') {
    return { ok: false, response: Response.json({ error: 'not_found', message: 'No such device.' }, { status: 404 }) };
  }
  return { ok: true, id, deviceId };
}

/** The agent's project folder on that device (docs/homes-spec.md §4.1). */
export async function PUT(request: NextRequest, { params }: Params) {
  const s = await scope(params);
  if (!s.ok) return s.response;
  const body = (await request.json().catch(() => ({}))) as { folder?: unknown };
  if (typeof body.folder !== 'string') return Response.json({ error: 'invalid_params', message: 'Choose a folder.' }, { status: 400 });
  try {
    await chooseWorkspaceFolder(s.id, s.deviceId, body.folder);
  } catch (err) {
    if (err instanceof FolderError) return Response.json({ error: 'not_there', message: err.message }, { status: 400 });
    throw err;
  }
  return Response.json({ devices: agentFoldersEverywhere(s.id) });
}

/** Take the agent off that device. Nothing there is deleted. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const s = await scope(params);
  if (!s.ok) return s.response;
  try {
    await removeFromDevice(s.id, s.deviceId);
  } catch (err) {
    if (err instanceof FolderError) return Response.json({ error: 'invalid_params', message: err.message }, { status: 400 });
    throw err;
  }
  return Response.json({ devices: agentFoldersEverywhere(s.id) });
}
