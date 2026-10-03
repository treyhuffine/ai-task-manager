import type { UpdateReferenceFolderInput } from '@/db/types';
import {
  getReferenceFolder,
  getWorkspace,
  ReferenceFolderError,
  updateReferenceFolder,
} from '@/lib/db/queries';
import { referenceFolders } from '@/lib/db/schema';
import { recycleForReferenceFolderChange } from '@/lib/executor/adapter';
import { resolveReferenceFolder } from '@/lib/reference-folders/resolve';
import { reply, type OperationContext } from '@/lib/server/operation';
import { createInsertSchema } from 'drizzle-zod';
import { z as rpcZ } from 'zod/v4';

function statusForReferenceError(code: ReferenceFolderError['code']): number {
  if (code === 'not_found') return 404;
  if (code === 'conflict') return 409;
  return 400;
}

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const row = getReferenceFolder(id);
    if (!row) return reply({ error: 'Reference folder not found' }, { status: 404 });
    const consumerCwd = row.workspaceId ? getWorkspace(row.workspaceId)?.cwd ?? null : null;
    const resolved = await resolveReferenceFolder(row, { consumerCwd });
    return reply(resolved ?? row);
  } catch (err) {
    console.error('[GET /api/reference-folders/:id]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as UpdateReferenceFolderInput;
    const before = getReferenceFolder(id);
    const row = updateReferenceFolder(id, body);
    if (!row) return reply({ error: 'Reference folder not found' }, { status: 404 });
    // A changed place on the home is recorded with it: check it's there (§4.1).
    const { checkHomeFolders } = await import('@/lib/setups/folders');
    await checkHomeFolders();
    // Recycle both scopes when the row moved between them (workspace ↔ global),
    // so neither the old nor the new audience keeps a stale list.
    await recycleForReferenceFolderChange(row.workspaceId);
    if (before && before.workspaceId !== row.workspaceId) {
      await recycleForReferenceFolderChange(before.workspaceId);
    }
    const consumerCwd = row.workspaceId ? getWorkspace(row.workspaceId)?.cwd ?? null : null;
    const resolved = await resolveReferenceFolder(row, { consumerCwd });
    return reply(resolved ?? row);
  } catch (err) {
    if (err instanceof ReferenceFolderError) {
      return reply(
        { error: err.message, code: err.code },
        { status: statusForReferenceError(err.code) },
      );
    }
    console.error('[PATCH /api/reference-folders/:id]', err);
    return reply({ error: String(err) }, { status: 400 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
export const PATCHInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: createInsertSchema(referenceFolders).pick({ "status": true, "description": true, "updatedAt": true, "position": true, "archivedAt": true, "workspaceId": true, "path": true, "alias": true, "targetWorkspaceId": true }).partial().strict().default({}) }).strict();
