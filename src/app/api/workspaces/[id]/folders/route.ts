import type { NextRequest } from 'next/server';
import { createReferenceFolder, getComputer, getWorkspace, ReferenceFolderError } from '@/lib/db/queries';
import { agentFoldersEverywhere, chooseLinkedFolder, FolderError } from '@/lib/setups/folders';

export const dynamic = 'force-dynamic';

/**
 * An agent's folders on each of the person's computers (docs/homes-spec.md
 * §4.1-4.2): its project folder there and each linked folder's place there,
 * as the home records them and each computer last found them.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getWorkspace(id)) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ computers: agentFoldersEverywhere(id) });
}

/**
 * Add a linked folder: its alias and description, for this agent or every
 * agent, and where it is on the computer it was added from. Other computers
 * choose their own place for it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getWorkspace(id)) return Response.json({ error: 'not_found' }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as {
    alias?: unknown;
    description?: unknown;
    forEveryAgent?: unknown;
    computerId?: unknown;
    folder?: unknown;
  };
  if (typeof body.alias !== 'string' || !body.alias.trim()) return Response.json({ error: 'invalid_params', message: 'Name it.' }, { status: 400 });
  if (typeof body.computerId !== 'string' || !getComputer(body.computerId)) {
    return Response.json({ error: 'invalid_params', message: 'Say which computer it is on.' }, { status: 400 });
  }
  if (typeof body.folder !== 'string' || !body.folder.trim()) return Response.json({ error: 'invalid_params', message: 'Choose where it is.' }, { status: 400 });
  let refId: string;
  try {
    refId = createReferenceFolder({
      workspaceId: body.forEveryAgent === true ? null : id,
      alias: body.alias,
      description: typeof body.description === 'string' ? body.description : null,
    }).id;
  } catch (err) {
    if (err instanceof ReferenceFolderError) {
      return Response.json({ error: err.code, message: err.message }, { status: err.code === 'conflict' ? 409 : 400 });
    }
    throw err;
  }
  try {
    await chooseLinkedFolder(refId, body.computerId, body.folder);
  } catch (err) {
    if (err instanceof FolderError) {
      // Nothing half-made: the linked folder goes with its place.
      const { archiveReferenceFolder } = await import('@/lib/db/queries');
      archiveReferenceFolder(refId);
      return Response.json({ error: 'not_there', message: err.message }, { status: 400 });
    }
    throw err;
  }
  return Response.json({ computers: agentFoldersEverywhere(id) }, { status: 201 });
}
