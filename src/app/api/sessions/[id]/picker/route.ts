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
import { NextRequest } from 'next/server';
import { getChatSession, listTasks, listNotes } from '@/lib/db/queries';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const showAll = url.searchParams.get('all') === '1';

    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

    const workspaceId = session.workspace_id;
    const taskFilter = !showAll && workspaceId ? { workspace_id: workspaceId } : {};
    const noteFilter = !showAll && workspaceId ? { workspace_id: workspaceId, status: 'active' as const } : { status: 'active' as const };

    const tasks = listTasks({ ...taskFilter, status: ['active', 'done'], limit: 200 });
    const notes = listNotes({ ...noteFilter, limit: 200 });

    return Response.json({
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        area_id: t.area_id,
        workspace_id: t.workspace_id,
        updated_at: t.updated_at,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        area_id: n.area_id,
        workspace_id: n.workspace_id,
        updated_at: n.updated_at,
      })),
    });
  } catch (err) {
    console.error('[GET /api/sessions/:id/picker]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
