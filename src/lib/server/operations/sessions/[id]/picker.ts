import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
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
import { getChatSession, listSessionReferences, REFERENCE_PAGE_SIZE } from '@/lib/db/queries';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const session = getChatSession(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });

    const query = rpcInput.query ?? {};
    const page = (kind: 'task' | 'note') => listSessionReferences({
      sessionId: id,
      workspaceId: session.workspaceId,
      q: query.q,
      kind,
      limit: query.limit ? Number(query.limit) : REFERENCE_PAGE_SIZE,
    });
    const total = (p: ReturnType<typeof page>) => p.counts.inChat + p.counts.workspace + p.counts.all;
    const tasks = query.kind === 'note' ? null : page('task');
    const notes = query.kind === 'task' ? null : page('note');

    return reply({
      tasks: (tasks?.rows ?? []).map((t) => ({ id: t.id, title: t.title, status: t.status ?? 'todo' })),
      notes: (notes?.rows ?? []).map((n) => ({ id: n.id, title: n.title })),
      totals: { tasks: tasks ? total(tasks) : 0, notes: notes ? total(notes) : 0 },
    });
  } catch (err) {
    console.error('[GET /api/sessions/:id/picker]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "q": rpcZ.string().max(200).optional(), "kind": rpcZ.enum(["task", "note"]).optional(), "limit": rpcZ.string().regex(/^[1-9]\d{0,2}$/).optional() }).strict().optional() }).strict();
