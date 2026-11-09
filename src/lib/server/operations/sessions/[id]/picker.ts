import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
import { getRequestKey } from '@/lib/auth/request-key';
import { sessionAuthority, executionOperationFailure } from '@/lib/workspaces/access';
/**
 * Tasks and notes for the composer's `@` picker, searched on the server so
 * a mention can reach anything in the home, not just what one request
 * loaded. Same list as the Notes & tasks view (`listSessionReferences`):
 * this chat's mentions first, then the chat's agent (open tasks first),
 * then everything else, and within each a title that is or starts with the
 * search ahead of one that only contains it.
 *
 * `kind` asks for one kind (`@task:` / `@note:`). Without it the picker gets
 * a short page of each. `totals` are every match, so the picker can say how
 * many more there are. Files come from the file-tree route, and the
 * scratchpad is one option the picker adds itself.
 */
import { getChatSession } from '@/lib/db/queries';
import { referencePicker } from '@/lib/sessions/reference-picker';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    sessionAuthority(getRequestKey(request.headers), id, 'read');
    const session = getChatSession(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });

    const query = rpcInput.query ?? {};
    return reply(referencePicker({
      sessionId: id,
      workspaceId: session.workspaceId,
      q: query.q,
      kind: query.kind,
      limit: query.limit ? Number(query.limit) : undefined,
    }));
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    console.error('[GET /api/sessions/:id/picker]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "q": rpcZ.string().max(200).optional(), "kind": rpcZ.enum(["task", "note"]).optional(), "limit": rpcZ.string().regex(/^[1-9]\d{0,2}$/).optional() }).strict().optional() }).strict();
