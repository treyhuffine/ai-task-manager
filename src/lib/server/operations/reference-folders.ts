import type { CreateReferenceFolderInput } from '@/db/types';
import { createReferenceFolder, getWorkspace, ReferenceFolderError } from '@/lib/db/queries';
import { referenceFolders } from '@/lib/db/schema';
import { recycleForReferenceFolderChange } from '@/lib/executor/adapter';
import { listResolvedReferenceFolders, resolveReferenceFolder } from '@/lib/reference-folders/resolve';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { checkHomeFolders } from '@/lib/setups/folders';
import { createInsertSchema } from 'drizzle-zod';
import { z as rpcZ } from 'zod/v4';

/** Map the query layer's typed failures onto HTTP without leaking stack traces. */
function statusForReferenceError(code: ReferenceFolderError['code']): number {
  if (code === 'not_found') return 404;
  if (code === 'conflict') return 409;
  return 400;
}

/**
 * Reference folders visible from a workspace: its own rows plus every global
 * one, resolved to absolute paths with existence and git state attached so the
 * settings list renders in a single round trip.
 *
 * `?workspaceId=` omitted lists the global rows alone.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const workspaceId = searchParams(rpcInput.query).get('workspaceId');
    const consumerCwd = workspaceId ? getWorkspace(workspaceId)?.cwd ?? null : null;
    const rows = await listResolvedReferenceFolders(workspaceId, { consumerCwd });
    return reply(rows);
  } catch (err) {
    console.error('[GET /api/reference-folders]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const body = (rpcInput.body) as CreateReferenceFolderInput;
    const row = createReferenceFolder(body);
    // Its place on the home is recorded with it: check it's there (§4.1).
    await checkHomeFolders();
    // Live sessions cache their config at spawn, so a new folder is invisible
    // to them until they recycle.
    await recycleForReferenceFolderChange(row.workspaceId);
    // Resolve on the way out so the client can render the new row (path, git,
    // broken badge) without refetching the whole list.
    const consumerCwd = row.workspaceId ? getWorkspace(row.workspaceId)?.cwd ?? null : null;
    const resolved = await resolveReferenceFolder(row, { consumerCwd });
    return reply(resolved ?? row, { status: 201 });
  } catch (err) {
    if (err instanceof ReferenceFolderError) {
      return reply(
        { error: err.message, code: err.code },
        { status: statusForReferenceError(err.code) },
      );
    }
    console.error('[POST /api/reference-folders]', err);
    return reply({ error: String(err) }, { status: 400 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "workspaceId": rpcZ.string().optional() }).strict().optional() }).strict().default({});
export const POSTInput = rpcZ.object({ body: createInsertSchema(referenceFolders).pick({ "description": true, "createdAt": true, "updatedAt": true, "position": true, "archivedAt": true, "workspaceId": true, "path": true, "alias": true, "targetWorkspaceId": true, "status": true, "id": true, "readOnly": true }).partial().extend({ "alias": createInsertSchema(referenceFolders).shape.alias }).strict() }).strict();
