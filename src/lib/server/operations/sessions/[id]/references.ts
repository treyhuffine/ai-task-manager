import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * GET — one page of the execution's Notes & tasks view. Three sections in
 * one order (in this chat, in this agent, everything else), paged with
 * `cursor` and searched with `q` across the whole home. Section membership
 * and order live in `listSessionReferences`, so the view never re-derives
 * them and a search never stops at the pages already loaded.
 *
 * POST — pin a task/note/area to the session (writes chat_refs row).
 * DELETE — unpin via ?entityType=&entityId= query.
 */
import {
  getChatSession,
  listSessionReferences,
  pinSessionRef,
  ReferenceCursorError,
  unpinSessionRef,
} from '@/lib/db/queries';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const session = getChatSession(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });

    const query = rpcInput.query ?? {};
    return reply(listSessionReferences({
      sessionId: id,
      workspaceId: session.workspaceId,
      q: query.q,
      cursor: query.cursor,
      limit: query.limit ? Number(query.limit) : undefined,
    }));
  } catch (err) {
    if (err instanceof ReferenceCursorError) {
      return reply({ error: err.message }, { status: 400 });
    }
    console.error('[GET /api/sessions/:id/references]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

interface PinBody {
  entityType?: 'task' | 'note' | 'area';
  entityId?: string;
  hydrate?: boolean;
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body: PinBody = rpcInput.body;
    const entityType = body.entityType;
    const entityId = body.entityId;
    if (!entityType || !entityId) {
      return reply({ error: 'entityType and entityId required' }, { status: 400 });
    }
    const session = getChatSession(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    pinSessionRef({
      sessionId: id,
      entityType: entityType,
      entityId: entityId,
      hydrate: body.hydrate ?? true,
      createdBy: 'user',
    });
    return reply({ ok: true }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/sessions/:id/references]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const url = new URL(request.url);
    const entityType = url.searchParams.get('entityType') as
      | 'task' | 'note' | 'area' | null;
    const entityId = url.searchParams.get('entityId');
    if (!entityType || !entityId) {
      return reply({ error: 'entityType and entityId required' }, { status: 400 });
    }
    const session = getChatSession(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    unpinSessionRef({
      sessionId: id,
      entityType: entityType,
      entityId: entityId,
    });
    return reply({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/sessions/:id/references]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "q": rpcZ.string().max(200).optional(), "cursor": rpcZ.string().max(1024).optional(), "limit": rpcZ.string().regex(/^[1-9]\d{0,2}$/).optional() }).strict().optional() }).strict();
export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "entityType": rpcZ.enum(["task", "note", "area"]).optional(), "entityId": rpcZ.string().optional(), "hydrate": rpcZ.boolean().optional() }).strict().default({}) }).strict();
export const DELETEInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "entityType": rpcZ.string().optional(), "entityId": rpcZ.string().optional() }).strict().optional(), body: rpcZ.object({}).strict().default({}) }).strict();
