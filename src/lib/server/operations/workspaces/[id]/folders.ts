import { createReferenceFolder, getDevice, getWorkspace, ReferenceFolderError } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { agentFoldersEverywhere, chooseLinkedFolder, FolderError } from '@/lib/setups/folders';
import { z as rpcZ } from 'zod/v4';

/**
 * An agent's folders on each of the person's devices (docs/homes-spec.md
 * §4.1-4.2): its project folder there and each linked folder's place there,
 * as the home records them and each device last found them.
 */
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  if (!getWorkspace(id)) return reply({ error: 'not_found' }, { status: 404 });
  return reply({ devices: agentFoldersEverywhere(id) });
}

/**
 * Add a linked folder: its alias and description, for this agent or every
 * agent, whether agents may change it, and where it is on the device it was
 * added from. Other devices choose their own place for it.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  if (!getWorkspace(id)) return reply({ error: 'not_found' }, { status: 404 });
  const body = (rpcInput.body) as {
    alias?: unknown;
    description?: unknown;
    forEveryAgent?: unknown;
    readOnly?: unknown;
    deviceId?: unknown;
    folder?: unknown;
  };
  if (typeof body.alias !== 'string' || !body.alias.trim()) return reply({ error: 'invalid_params', message: 'Name it.' }, { status: 400 });
  if (typeof body.deviceId !== 'string' || !getDevice(body.deviceId)) {
    return reply({ error: 'invalid_params', message: 'Say which device it is on.' }, { status: 400 });
  }
  if (typeof body.folder !== 'string' || !body.folder.trim()) return reply({ error: 'invalid_params', message: 'Choose where it is.' }, { status: 400 });
  let refId: string;
  try {
    refId = createReferenceFolder({
      workspaceId: body.forEveryAgent === true ? null : id,
      alias: body.alias,
      description: typeof body.description === 'string' ? body.description : null,
      ...(typeof body.readOnly === 'boolean' ? { readOnly: body.readOnly } : {}),
    }).id;
  } catch (err) {
    if (err instanceof ReferenceFolderError) {
      return reply({ error: err.code, message: err.message }, { status: err.code === 'conflict' ? 409 : 400 });
    }
    throw err;
  }
  try {
    await chooseLinkedFolder(refId, body.deviceId, body.folder);
  } catch (err) {
    if (err instanceof FolderError) {
      // Nothing half-made: the linked folder goes with its place.
      const { archiveReferenceFolder } = await import('@/lib/db/queries');
      archiveReferenceFolder(refId);
      return reply({ error: 'not_there', message: err.message }, { status: 400 });
    }
    throw err;
  }
  return reply({ devices: agentFoldersEverywhere(id) }, { status: 201 });
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "alias": rpcZ.string().optional(), "description": rpcZ.string().nullable().optional(), "forEveryAgent": rpcZ.boolean().optional(), "readOnly": rpcZ.boolean().optional(), "deviceId": rpcZ.string().optional(), "folder": rpcZ.string().nullable().optional() }).strict().default({}) }).strict();
