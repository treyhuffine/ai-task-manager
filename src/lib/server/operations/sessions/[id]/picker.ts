import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Feeds the composer's `@`-picker with entities (tasks + notes) the
 * user can reference inside a session. Files come from the file-tree
 * route already — the picker merges them with the response from here
 * on the client side. Scratchpad is a single ambient option that the
 * picker injects without a server call (one per session, always
 * present).
 *
 * Default shape:
 *   - tasks: workspace-scoped, active first, then done — ranked for
 *     "what's on my plate for this codebase right now."
 *   - notes: workspace-scoped, recency-ordered.
 *   - `all` flag returns everything for the "Show all" toggle.
 */
import { getChatSession, listNotes, listTasks } from '@/lib/db/queries';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const url = new URL(request.url);
    const showAll = url.searchParams.get('all') === '1';

    const session = getChatSession(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });

    const workspaceId = session.workspaceId;
    const taskFilter = !showAll && workspaceId ? { workspaceId: workspaceId } : {};
    const noteFilter = !showAll && workspaceId ? { workspaceId: workspaceId, status: 'active' as const } : { status: 'active' as const };

    const tasks = listTasks({ ...taskFilter, status: ['active', 'done'], limit: 200 });
    const notes = listNotes({ ...noteFilter, limit: 200 });

    return reply({
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        areaId: t.areaId,
        workspaceId: t.workspaceId,
        updatedAt: t.updatedAt,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        areaId: n.areaId,
        workspaceId: n.workspaceId,
        updatedAt: n.updatedAt,
      })),
    });
  } catch (err) {
    console.error('[GET /api/sessions/:id/picker]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "all": rpcZ.string().optional() }).strict().optional() }).strict();
