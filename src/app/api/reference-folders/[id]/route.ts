import type { NextRequest } from 'next/server';
import {
  getReferenceFolder,
  getWorkspace,
  updateReferenceFolder,
  ReferenceFolderError,
} from '@/lib/db/queries';
import { resolveReferenceFolder } from '@/lib/reference-folders/resolve';
import { recycleForReferenceFolderChange } from '@/lib/executor/adapter';
import type { UpdateReferenceFolderInput } from '@/db/types';

function statusForReferenceError(code: ReferenceFolderError['code']): number {
  if (code === 'not_found') return 404;
  if (code === 'conflict') return 409;
  return 400;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = getReferenceFolder(id);
    if (!row) return Response.json({ error: 'Reference folder not found' }, { status: 404 });
    const consumerCwd = row.workspaceId ? getWorkspace(row.workspaceId)?.cwd ?? null : null;
    const resolved = await resolveReferenceFolder(row, { consumerCwd });
    return Response.json(resolved ?? row);
  } catch (err) {
    console.error('[GET /api/reference-folders/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as UpdateReferenceFolderInput;
    const before = getReferenceFolder(id);
    const row = updateReferenceFolder(id, body);
    if (!row) return Response.json({ error: 'Reference folder not found' }, { status: 404 });
    // Recycle both scopes when the row moved between them (workspace ↔ global),
    // so neither the old nor the new audience keeps a stale list.
    await recycleForReferenceFolderChange(row.workspaceId);
    if (before && before.workspaceId !== row.workspaceId) {
      await recycleForReferenceFolderChange(before.workspaceId);
    }
    const consumerCwd = row.workspaceId ? getWorkspace(row.workspaceId)?.cwd ?? null : null;
    const resolved = await resolveReferenceFolder(row, { consumerCwd });
    return Response.json(resolved ?? row);
  } catch (err) {
    if (err instanceof ReferenceFolderError) {
      return Response.json(
        { error: err.message, code: err.code },
        { status: statusForReferenceError(err.code) },
      );
    }
    console.error('[PATCH /api/reference-folders/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
