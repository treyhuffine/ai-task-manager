import type { UpdateDeckInput } from '@/db/types';
import { getDeck, updateDeck } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const deck = getDeck(id);

    if (!deck) {
      return reply({ error: 'Deck not found' }, { status: 404 });
    }

    return reply(deck);
  } catch (err) {
    console.error('[GET /api/deck/:id]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body: UpdateDeckInput = rpcInput.body;
    const deck = updateDeck(id, body);

    if (!deck) {
      return reply({ error: 'Deck not found' }, { status: 404 });
    }

    return reply(deck);
  } catch (err) {
    console.error('[PATCH /api/deck/:id]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
export const PATCHInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "updatedAt": rpcZ.string().optional(), "model": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "origin": rpcZ.enum(["manual", "morning", "first_open", "midday"]).optional(), "context": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "contextTags": rpcZ.union([rpcZ.null(), rpcZ.array(rpcZ.string())]).optional(), "framing": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "items": rpcZ.array(rpcZ.object({ "taskId": rpcZ.string(), "rationale": rpcZ.string(), "continuityContext": rpcZ.union([rpcZ.null(), rpcZ.string()]), "source": rpcZ.enum(["ai", "user"]) }).strict()).optional(), "alternatives": rpcZ.array(rpcZ.object({ "taskId": rpcZ.string(), "reason": rpcZ.string() }).strict()).optional(), "searchContext": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "forDate": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "supersededAt": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "replacesDeckId": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "changes": rpcZ.array(rpcZ.object({ "kind": rpcZ.enum(["carried", "deferred", "dropped", "added", "reordered", "bumped"]), "taskId": rpcZ.string(), "title": rpcZ.string().optional(), "reason": rpcZ.string(), "source": rpcZ.enum(["user", "reconcile", "calendar"]), "channel": rpcZ.enum(["absorb", "digest", "interrupt"]).optional() }).strict()).optional(), "calendarSnapshot": rpcZ.array(rpcZ.object({ "start": rpcZ.string(), "end": rpcZ.string(), "title": rpcZ.string(), "source": rpcZ.string() }).strict()).optional() }).strict().default({}) }).strict();
