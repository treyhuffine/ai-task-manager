import type { NextRequest } from 'next/server';
import { getDevice, getWorkspace, listReferenceFoldersForWorkspace } from '@/lib/db/queries';
import { agentFoldersEverywhere, chooseLinkedFolder, FolderError } from '@/lib/setups/folders';

export const dynamic = 'force-dynamic';

/**
 * Where one of the agent's linked folders is on that device, or
 * `folder: null` to go without it there (docs/homes-spec.md §4.1). A linked
 * folder every agent uses has one place per device: this sets it for all.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; deviceId: string; referenceFolderId: string }> },
) {
  const { id, deviceId, referenceFolderId } = await params;
  if (!getWorkspace(id)) return Response.json({ error: 'not_found' }, { status: 404 });
  const device = getDevice(deviceId);
  if (!device || device.status !== 'active') return Response.json({ error: 'not_found', message: 'No such device.' }, { status: 404 });
  const ref = listReferenceFoldersForWorkspace(id).find((r) => r.id === referenceFolderId);
  if (!ref) return Response.json({ error: 'not_found', message: 'The agent has no such linked folder.' }, { status: 404 });
  if (ref.targetWorkspaceId) {
    return Response.json({ error: 'invalid_params', message: "That's another agent: it's that agent's own folder on each device." }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as { folder?: unknown };
  if (body.folder !== null && typeof body.folder !== 'string') {
    return Response.json({ error: 'invalid_params', message: 'Choose a folder, or null to go without it.' }, { status: 400 });
  }
  try {
    await chooseLinkedFolder(referenceFolderId, deviceId, body.folder as string | null);
  } catch (err) {
    if (err instanceof FolderError) return Response.json({ error: 'not_there', message: err.message }, { status: 400 });
    throw err;
  }
  return Response.json({ devices: agentFoldersEverywhere(id) });
}
