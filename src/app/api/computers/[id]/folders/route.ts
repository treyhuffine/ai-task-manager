import type { NextRequest } from 'next/server';
import { getComputer } from '@/lib/db/queries';
import { FoldersUnavailableError, listComputerFolders } from '@/lib/setups/folders';
import { FolderListingError } from '@/lib/setups/folders-here';

export const dynamic = 'force-dynamic';

/**
 * A folder's folders on one of the person's computers, for choosing an
 * agent's folder there (docs/homes-spec.md §4.2): the home's own disk, or a
 * computer elsewhere through its worker. Within the person's home folder.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const computer = getComputer(id);
  if (!computer || computer.status !== 'active') return Response.json({ error: 'not_found' }, { status: 404 });
  try {
    return Response.json(await listComputerFolders(id, request.nextUrl.searchParams.get('path')));
  } catch (err) {
    if (err instanceof FoldersUnavailableError) return Response.json({ error: 'unavailable', message: err.message }, { status: 409 });
    if (err instanceof FolderListingError) return Response.json({ error: 'folders', message: err.message }, { status: 400 });
    throw err;
  }
}
