import { getDevice } from '@/lib/db/queries';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { FoldersUnavailableError, listDeviceFolders } from '@/lib/setups/folders';
import { FolderListingError } from '@/lib/setups/folders-here';
import { z as rpcZ } from 'zod/v4';

/**
 * A folder's folders on one of the person's devices, for choosing an
 * agent's folder there (docs/homes-spec.md §4.2): the home's own disk, or a
 * device elsewhere through its worker. Within the person's home folder.
 */
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const device = getDevice(id);
  if (!device || device.status !== 'active') return reply({ error: 'not_found' }, { status: 404 });
  try {
    return reply(await listDeviceFolders(id, searchParams(rpcInput.query).get('path')));
  } catch (err) {
    if (err instanceof FoldersUnavailableError) return reply({ error: 'unavailable', message: err.message }, { status: 409 });
    if (err instanceof FolderListingError) return reply({ error: 'folders', message: err.message }, { status: 400 });
    throw err;
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "path": rpcZ.string().optional() }).strict().optional() }).strict();
