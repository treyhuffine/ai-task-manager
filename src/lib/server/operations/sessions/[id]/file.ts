import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { readAnswerOnOwner, writeAnswerOnOwner } from '@/lib/executor/owner-files';
import { fileBody } from '@/lib/server/inputs';
import { answerResult, failureResponse, reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { deletePathSchema, fileResponseSchema, writeFileSchema } from '@/lib/server/remote-contracts';
import { whileOperationAdmitted as whileAdmitted } from '@/lib/transfer/moving';
import { openWorktreeHandle } from '@/lib/workspaces';
import { fileReadResult } from '@/lib/workspaces/file-http';
import { mapFileError, openSessionWorktree } from "@/lib/workspaces/session-files";
import { deleteWorkspacePath, writeWorkspaceFile } from '@/lib/workspaces/write-file';
import { z as rpcZ } from 'zod/v4';

/**
 * Single-file CRUD for the execution view's file viewer.
 *
 * GET — read content (with optional `?base=1` for the diff "old" side).
 * PUT — upsert file content. Body: `{ content: string }`. Creates parent
 *       dirs if missing. Used both by Save (existing file) and the
 *       create-then-edit flow (the tree's "New File" mints an empty file
 *       up front, so by the time Save fires the path always exists).
 * DELETE — remove the path (file or recursive dir).
 *
 * Both mutations stay deliberately small — no checkpointing, no git add,
 * no diff invalidation here. The client invalidates the React Query
 * caches that depend on worktree state once the route returns; git
 * status flips in/out via the same `tree` refetch path the agent uses.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const relPath = searchParams(rpcInput.query).get('path');
    const wantBase = searchParams(rpcInput.query).get('base') === '1';

    if (!relPath) {
      return reply({ error: 'Missing path parameter' }, { status: 400 });
    }

    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    // An execution on a connected device: its worker answers.
    const remote = await readAnswerOnOwner(id, { kind: 'file', path: relPath, base: wantBase });
    if (remote) return answerResult(remote, fileResponseSchema);
    if (!session.workspaceId || !session.worktreePath) {
      return reply({ error: 'Workspace has no worktree' }, { status: 404 });
    }

    const ws = getWorkspace(session.workspaceId);
    if (!ws) return reply({ error: 'Workspace not found' }, { status: 404 });

    const handle = await openWorktreeHandle(session, ws);
    if (!handle) return reply({ error: 'Worktree unavailable' }, { status: 404 });

    return await fileReadResult(handle, relPath, wantBase);
  } catch (err) {
    return failureResponse(mapFileError(err, '[GET /api/sessions/:id/file]'));
  }
}

async function handlePUT(rpcInput: rpcZ.infer<typeof PUTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const relPath = request.nextUrl.searchParams.get('path');
    if (!relPath) {
      return reply({ error: 'Missing path parameter' }, { status: 400 });
    }

    const body = (rpcInput.body) as { content?: unknown } | null;
    if (!body || typeof body.content !== 'string') {
      return reply({ error: 'Body must be { content: string }' }, { status: 400 });
    }

    const owner = await writeAnswerOnOwner(id, { kind: 'write', path: relPath, content: body.content });
    if (owner) return answerResult(owner, writeFileSchema);

    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return failureResponse(resolved.response);

    const result = await writeWorkspaceFile(resolved.handle, relPath, body.content);
    return reply({ ok: true, ...result });
  } catch (err) {
    return failureResponse(mapFileError(err, '[PUT /api/sessions/:id/file]'));
  }
}

async function handleDELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const relPath = request.nextUrl.searchParams.get('path');
    if (!relPath) {
      return reply({ error: 'Missing path parameter' }, { status: 400 });
    }

    const owner = await writeAnswerOnOwner(id, { kind: 'delete', path: relPath });
    if (owner) return answerResult(owner, deletePathSchema);

    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return failureResponse(resolved.response);

    const result = await deleteWorkspacePath(resolved.handle, relPath);
    return reply({ ok: true, ...result });
  } catch (err) {
    return failureResponse(mapFileError(err, '[DELETE /api/sessions/:id/file]'));
  }
}

/** A change to its files, counted while it runs: never under a move (P4 review). */
export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  return whileAdmitted(id, 'changing its files', () => handlePUT(rpcInput, request));
}

/** A change to its files, counted while it runs: never under a move (P4 review). */
export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  return whileAdmitted(id, 'changing its files', () => handleDELETE(rpcInput, request));
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "path": rpcZ.string().optional(), "base": rpcZ.string().optional() }).strict().optional() }).strict();
export const PUTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ path: rpcZ.string().optional() }).strict().optional(), body: fileBody }).strict();
export const DELETEInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ path: rpcZ.string().optional() }).strict().optional(), body: rpcZ.object({}).strict().default({}) }).strict();
