import { getDevice, getWorkspace } from '@/lib/db/queries';
import { reply, type OperationContext, type OperationFailure } from '@/lib/server/operation';
import { agentFoldersEverywhere, chooseWorkspaceFolder, FolderError, removeFromDevice } from '@/lib/setups/folders';
import { z as rpcZ } from 'zod/v4';

type Params = { params: Promise<{ id: string; deviceId: string }> };

type Scope = { ok: true; id: string; deviceId: string } | { ok: false; response: OperationFailure };

async function scope(params: Params['params']): Promise<Scope> {
  const { id, deviceId } = await params;
  if (!getWorkspace(id)) return { ok: false, response: reply({ error: 'not_found' }, { status: 404 }) };
  const device = getDevice(deviceId);
  if (!device || device.status !== 'active') {
    return { ok: false, response: reply({ error: 'not_found', message: 'No such device.' }, { status: 404 }) };
  }
  return { ok: true, id, deviceId };
}

/** The agent's project folder on that device (docs/homes-spec.md §4.1). */
export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  const s = await scope(Promise.resolve(rpcInput.params));
  if (!s.ok) return s.response;
  const body = (rpcInput.body) as { folder?: unknown };
  if (typeof body.folder !== 'string') return reply({ error: 'invalid_params', message: 'Choose a folder.' }, { status: 400 });
  try {
    await chooseWorkspaceFolder(s.id, s.deviceId, body.folder);
  } catch (err) {
    if (err instanceof FolderError) return reply({ error: 'not_there', message: err.message }, { status: 400 });
    throw err;
  }
  return reply({ devices: agentFoldersEverywhere(s.id) });
}

/** Take the agent off that device. Nothing there is deleted. */
export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, _request: OperationContext) {
  const s = await scope(Promise.resolve(rpcInput.params));
  if (!s.ok) return s.response;
  try {
    await removeFromDevice(s.id, s.deviceId);
  } catch (err) {
    if (err instanceof FolderError) return reply({ error: 'invalid_params', message: err.message }, { status: 400 });
    throw err;
  }
  return reply({ devices: agentFoldersEverywhere(s.id) });
}

export const PUTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1), "deviceId": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "folder": rpcZ.string().nullable().optional() }).strict().default({}) }).strict();
export const DELETEInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1), "deviceId": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
