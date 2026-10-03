import { getDevice, getWorkspace, listReferenceFoldersForWorkspace } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { agentFoldersEverywhere, chooseLinkedFolder, FolderError } from '@/lib/setups/folders';
import { z as rpcZ } from 'zod/v4';

/**
 * Where one of the agent's linked folders is on that device, or
 * `folder: null` to go without it there (docs/homes-spec.md §4.1). A linked
 * folder every agent uses has one place per device: this sets it for all.
 */
export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  const { id, deviceId, referenceFolderId } = rpcInput.params;
  if (!getWorkspace(id)) return reply({ error: 'not_found' }, { status: 404 });
  const device = getDevice(deviceId);
  if (!device || device.status !== 'active') return reply({ error: 'not_found', message: 'No such device.' }, { status: 404 });
  const ref = listReferenceFoldersForWorkspace(id).find((r) => r.id === referenceFolderId);
  if (!ref) return reply({ error: 'not_found', message: 'The agent has no such linked folder.' }, { status: 404 });
  if (ref.targetWorkspaceId) {
    return reply({ error: 'invalid_params', message: "That's another agent: it's that agent's own folder on each device." }, { status: 400 });
  }
  const body = (rpcInput.body) as { folder?: unknown };
  if (body.folder !== null && typeof body.folder !== 'string') {
    return reply({ error: 'invalid_params', message: 'Choose a folder, or null to go without it.' }, { status: 400 });
  }
  try {
    await chooseLinkedFolder(referenceFolderId, deviceId, body.folder as string | null);
  } catch (err) {
    if (err instanceof FolderError) return reply({ error: 'not_there', message: err.message }, { status: 400 });
    throw err;
  }
  return reply({ devices: agentFoldersEverywhere(id) });
}

export const PUTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1), "deviceId": rpcZ.string().min(1), "referenceFolderId": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "folder": rpcZ.string().nullable().optional() }).strict().default({}) }).strict();
